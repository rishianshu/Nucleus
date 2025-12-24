package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/nucleus/store-core/pkg/logstore"
)

const checkpointHistoryTable = "checkpoints"

// CheckpointHistory wraps log-store operations for checkpoint archival.
type CheckpointHistory struct {
	store logstore.Store
}

// NewCheckpointHistory creates a checkpoint history handler.
// Returns nil if log-store is not configured (graceful degradation).
func NewCheckpointHistory() (*CheckpointHistory, error) {
	store, err := logstore.NewGatewayStoreFromEnv()
	if err != nil {
		// Log-store not available, return nil for graceful degradation
		return nil, nil
	}
	return &CheckpointHistory{store: store}, nil
}

// ArchiveCheckpoint pushes the current checkpoint to log-store before update.
// Returns the history reference (minio:// URL) or empty string on failure.
func (h *CheckpointHistory) ArchiveCheckpoint(ctx context.Context, key string, cp map[string]any, version int) (string, error) {
	if h == nil || h.store == nil {
		return "", nil // Graceful degradation
	}

	// Ensure table exists (idempotent)
	_ = h.store.CreateTable(ctx, checkpointHistoryTable)

	// Serialize checkpoint
	snapshot, err := json.Marshal(cp)
	if err != nil {
		return "", fmt.Errorf("marshal checkpoint: %w", err)
	}

	// Write snapshot with version suffix
	runID := fmt.Sprintf("%s-v%d", sanitizeKey(key), version)
	ref, err := h.store.WriteSnapshot(ctx, checkpointHistoryTable, runID, snapshot)
	if err != nil {
		return "", fmt.Errorf("write snapshot: %w", err)
	}

	return ref, nil
}

// GetCheckpointHistory retrieves historical checkpoints from log-store.
// Returns snapshots sorted by version descending (newest first).
func (h *CheckpointHistory) GetCheckpointHistory(ctx context.Context, key string, limit int) ([]map[string]any, error) {
	if h == nil || h.store == nil {
		return nil, nil // Graceful degradation
	}

	prefix := fmt.Sprintf("logs/%s/%s", checkpointHistoryTable, sanitizeKey(key))
	paths, err := h.store.ListPaths(ctx, prefix)
	if err != nil {
		return nil, fmt.Errorf("list paths: %w", err)
	}

	// Sort by version descending
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))

	// Limit results
	if limit > 0 && len(paths) > limit {
		paths = paths[:limit]
	}

	// For now, just return the paths (actual snapshot loading requires MinIO GET)
	results := make([]map[string]any, len(paths))
	for i, p := range paths {
		results[i] = map[string]any{
			"path":    p,
			"version": extractVersion(p),
		}
	}

	return results, nil
}

// sanitizeKey makes the key safe for file paths.
func sanitizeKey(key string) string {
	// Replace :: with / for hierarchical paths
	key = strings.ReplaceAll(key, "::", "/")
	// Remove unsafe characters
	key = strings.ReplaceAll(key, " ", "_")
	return key
}

// extractVersion extracts version number from snapshot path.
func extractVersion(path string) int {
	// Path format: .../key-v123.snapshot.json
	base := strings.TrimSuffix(path, ".snapshot.json")
	parts := strings.Split(base, "-v")
	if len(parts) < 2 {
		return 0
	}
	var v int
	fmt.Sscanf(parts[len(parts)-1], "%d", &v)
	return v
}

// RetentionPolicy defines how long to keep checkpoint history.
type RetentionPolicy struct {
	// MaxDays is the maximum age in days for checkpoint snapshots.
	// Snapshots older than this are pruned.
	MaxDays int
}

// DefaultRetentionPolicy returns a sensible default retention policy.
func DefaultRetentionPolicy() RetentionPolicy {
	return RetentionPolicy{
		MaxDays: 30, // Keep checkpoints for 30 days
	}
}

// PruneHistory removes old checkpoint snapshots beyond the retention limit.
// Uses time-based pruning via the log-store's built-in Prune method.
func (h *CheckpointHistory) PruneHistory(ctx context.Context, policy RetentionPolicy) error {
	if h == nil || h.store == nil {
		return nil // Graceful degradation
	}

	// Use log-store's Prune method which handles time-based cleanup
	return h.store.Prune(ctx, checkpointHistoryTable, policy.MaxDays)
}

// ArchiveAndPrune archives current checkpoint and applies retention policy.
// This is the recommended method to use for checkpoint history management.
func (h *CheckpointHistory) ArchiveAndPrune(ctx context.Context, key string, cp map[string]any, version int, policy RetentionPolicy) (string, error) {
	ref, err := h.ArchiveCheckpoint(ctx, key, cp, version)
	if err != nil {
		return "", err
	}

	// Apply retention policy asynchronously in background
	go func() {
		_ = h.PruneHistory(context.Background(), policy)
	}()

	return ref, nil
}
