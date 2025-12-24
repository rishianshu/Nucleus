package activities

import (
	"context"
	"strconv"

	"github.com/nucleus/ucl-core/pkg/logstore"
	"go.temporal.io/sdk/activity"
)

// GCLogStoreActivity prunes LogStore logs using LOGSTORE_RETENTION_DAYS (if >0).
func (a *Activities) GCLogStoreActivity(ctx context.Context) error {
	logger := activity.GetLogger(ctx)
	retStr := getenv("LOGSTORE_RETENTION_DAYS", "")
	if retStr == "" {
		logger.Info("logstore-gc-skip", "reason", "retention unset")
		return nil
	}
	retention, err := strconv.Atoi(retStr)
	if err != nil || retention <= 0 {
		logger.Info("logstore-gc-skip", "reason", "retention<=0")
		return nil
	}
	store, err := logstore.NewMinioStoreFromEnv()
	if err != nil {
		logger.Warn("logstore-gc-init-failed", "err", err)
		return err
	}
	if err := store.Prune(ctx, "logs", retention); err != nil {
		logger.Warn("logstore-gc-failed", "err", err)
		return err
	}
	logger.Info("logstore-gc-done", "retentionDays", retention)
	return nil
}
