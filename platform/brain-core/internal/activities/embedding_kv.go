package activities

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// makeEmbeddingHashKey creates a KV key for storing content hash of a vector entry.
// Format: embed:<profileID>:<nodeID>
func makeEmbeddingHashKey(profileID, nodeID string) string {
	return fmt.Sprintf("embed:%s:%s", profileID, nodeID)
}

// hashContent computes SHA256 hash of the content text.
func hashContent(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

// loadEmbeddingHash retrieves the stored content hash for a vector entry.
// Returns empty string if not found.
func loadEmbeddingHash(ctx context.Context, tenantID, projectID, profileID, nodeID string) (string, error) {
	m, err := loadCheckpointKV(ctx, tenantID, projectID, makeEmbeddingHashKey(profileID, nodeID))
	if err != nil || m == nil {
		return "", err
	}
	if hash, ok := m["contentHash"].(string); ok {
		return hash, nil
	}
	return "", nil
}

// saveEmbeddingHash stores the content hash for a vector entry.
// Used to skip re-embedding unchanged content on subsequent runs.
func saveEmbeddingHash(ctx context.Context, tenantID, projectID, profileID, nodeID, contentHash string) {
	cp := NewEmbeddingHashCheckpoint(contentHash)
	_ = saveCheckpointKV(ctx, tenantID, projectID, makeEmbeddingHashKey(profileID, nodeID), ToMap(cp))
}
