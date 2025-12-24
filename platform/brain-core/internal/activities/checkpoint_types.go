package activities

import (
	"encoding/json"
	"time"
)

// IndexerCheckpoint represents the checkpoint state for IndexArtifact activity.
// Matches the structure expected by TypeScript IngestionCheckpointRecord.
type IndexerCheckpoint struct {
	// BatchRef is the current staging batch being processed
	BatchRef string `json:"batchRef,omitempty"`
	// RecordOffset is the position within the current batch
	RecordOffset int `json:"recordOffset,omitempty"`
	// Cursor is a string cursor for non-staging mode
	Cursor string `json:"cursor,omitempty"`
	// RunID is the workflow run that last updated this checkpoint
	RunID string `json:"runId,omitempty"`
	// LastRun is the last completed run timestamp
	LastRun string `json:"lastRun,omitempty"`
	// Watermark is an RFC3339 timestamp for incremental processing
	Watermark string `json:"watermark,omitempty"`
}

// EmbeddingHashCheckpoint stores content hash for an embedding entry.
// Used to skip re-embedding unchanged content.
type EmbeddingHashCheckpoint struct {
	// ContentHash is the SHA256 of the embedded content text
	ContentHash string `json:"contentHash"`
	// SavedAt is when this hash was saved (RFC3339)
	SavedAt string `json:"savedAt"`
}

// InsightSignatureCheckpoint stores insight caching signature.
type InsightSignatureCheckpoint struct {
	// Signature is the hash of skill+entityRef+params
	Signature string `json:"signature"`
	// GeneratedAt is when this was generated (RFC3339)
	GeneratedAt string `json:"generatedAt"`
}

// ToMap converts a typed checkpoint to map[string]any for storage.
// Maintains backward compatibility with existing KV operations.
func ToMap(v any) map[string]any {
	data, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	return m
}

// FromMap converts map[string]any to a typed checkpoint struct.
func FromMap[T any](m map[string]any) (T, error) {
	var result T
	data, err := json.Marshal(m)
	if err != nil {
		return result, err
	}
	err = json.Unmarshal(data, &result)
	return result, err
}

// NewIndexerCheckpoint creates a new checkpoint with current timestamp.
func NewIndexerCheckpoint() *IndexerCheckpoint {
	return &IndexerCheckpoint{
		LastRun: time.Now().UTC().Format(time.RFC3339),
	}
}

// NewEmbeddingHashCheckpoint creates a new embedding hash checkpoint.
func NewEmbeddingHashCheckpoint(contentHash string) *EmbeddingHashCheckpoint {
	return &EmbeddingHashCheckpoint{
		ContentHash: contentHash,
		SavedAt:     time.Now().UTC().Format(time.RFC3339),
	}
}
