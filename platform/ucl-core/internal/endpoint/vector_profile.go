package endpoint

// VectorIndexRecord represents a normalized record ready for vector indexing.
// This is the output format expected by brain-worker for embedding and storage.
type VectorIndexRecord struct {
	NodeID       string         `json:"nodeId"`       // Stable unique identifier
	ProfileID    string         `json:"profileId"`    // Vector profile ID (e.g., source.github.code.v1)
	EntityKind   string         `json:"entityKind"`   // Entity type (e.g., code.file_chunk, work.item)
	Text         string         `json:"text"`         // Content to embed
	SourceFamily string         `json:"sourceFamily"` // Source system (e.g., github, jira)
	TenantID     string         `json:"tenantId"`     // Tenant identifier
	ProjectKey   string         `json:"projectKey"`   // Project identifier (e.g., owner/repo)
	SourceURL    string         `json:"sourceUrl"`    // URL to source item
	ExternalID   string         `json:"externalId"`   // External system ID
	Metadata     map[string]any `json:"metadata"`     // Additional metadata
	RawPayload   map[string]any `json:"rawPayload"`   // Original payload for reference
}

// VectorProfileProvider is an optional interface that endpoints can implement
// to provide vector indexing support. When an endpoint implements this interface,
// the staging layer will automatically produce normalized VectorIndexRecords
// that brain-worker can directly embed and store.
type VectorProfileProvider interface {
	// GetVectorProfile returns the profile ID for a given entity kind.
	// This determines which normalizer and embedding settings to use.
	GetVectorProfile(entityKind string) string

	// NormalizeForIndex transforms a raw ingestion record into a normalized
	// VectorIndexRecord suitable for embedding. Returns false if the record
	// should not be indexed (e.g., missing required fields).
	NormalizeForIndex(rec Record) (VectorIndexRecord, bool)
}
