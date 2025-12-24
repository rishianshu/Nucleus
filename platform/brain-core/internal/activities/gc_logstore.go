package activities

import (
	"context"
	"strconv"

	"github.com/nucleus/ucl-core/pkg/logstore"
	"go.temporal.io/sdk/activity"
)

// GCLogStore prunes LogStore data older than retention days (env LOGSTORE_RETENTION_DAYS).
func (a *Activities) GCLogStore(ctx context.Context, table string) error {
	logger := activity.GetLogger(ctx)
	retStr := getenv("LOGSTORE_RETENTION_DAYS", "")
	retention := 0
	if retStr != "" {
		if v, err := strconv.Atoi(retStr); err == nil {
			retention = v
		}
	}
	if retention <= 0 {
		logger.Info("logstore-gc-skip", "reason", "retention<=0")
		return nil
	}
	store, err := logstore.NewMinioStoreFromEnv()
	if err != nil {
		return err
	}
	target := table
	if target == "" {
		target = "logs"
	}
	if err := store.Prune(ctx, target, retention); err != nil {
		logger.Warn("logstore-gc-failed", "err", err)
		return err
	}
	logger.Info("logstore-gc-done", "table", target, "retentionDays", retention)
	return nil
}
