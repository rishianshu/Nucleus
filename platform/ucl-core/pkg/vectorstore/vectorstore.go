package vectorstore

import "time"

// NOTE: This package defines the canonical vector entry contract and a store interface.
// The actual implementation (pgvector or otherwise) will live in a separate module.
// Table DDL reference (pgvector):
//
// CREATE TABLE IF NOT EXISTS vector_entries (
//   tenant_id        text NOT NULL,
//   project_id       text NOT NULL,
//   profile_id       text NOT NULL,
//   node_id          text NOT NULL,
//   source_family    text,
//   artifact_id      text,
//   run_id           text,
//   sink_endpoint_id text,
//   dataset_slug     text,
//   entity_kind      text,
//   labels           text[],
//   tags             text[],
//   content_text     text,
//   metadata         jsonb,
//   raw_payload      jsonb,
//   raw_metadata     jsonb,
//   embedding        vector(1536),
//   created_at       timestamptz NOT NULL DEFAULT now(),
//   updated_at       timestamptz NOT NULL DEFAULT now(),
//   PRIMARY KEY (tenant_id, project_id, profile_id, node_id)
// );
// CREATE INDEX IF NOT EXISTS vector_entries_profile_idx ON vector_entries (tenant_id, project_id, profile_id);
// CREATE INDEX IF NOT EXISTS vector_entries_artifact_idx ON vector_entries (tenant_id, artifact_id, run_id);
// CREATE INDEX IF NOT EXISTS vector_entries_meta_idx ON vector_entries USING gin (metadata);
// CREATE INDEX IF NOT EXISTS vector_entries_embedding_idx ON vector_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

// Entry represents a normalized vector document ready for embedding/indexing.
type Entry struct {
	TenantID       string         `json:"tenantId"`
	ProjectID      string         `json:"projectId"`
	ProfileID      string         `json:"profileId"`
	NodeID         string         `json:"nodeId"`
	SourceFamily   string         `json:"sourceFamily,omitempty"`
	ArtifactID     string         `json:"artifactId,omitempty"`
	RunID          string         `json:"runId,omitempty"`
	SinkEndpointID string         `json:"sinkEndpointId,omitempty"`
	DatasetSlug    string         `json:"datasetSlug,omitempty"`
	EntityKind     string         `json:"entityKind,omitempty"`
	Labels         []string       `json:"labels,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	ContentText    string         `json:"contentText,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`   // Profile-specific filterable fields
	RawPayload     map[string]any `json:"rawPayload,omitempty"` // For lineage/debug
	RawMetadata    map[string]any `json:"rawMetadata,omitempty"`
	Embedding      []float32      `json:"embedding,omitempty"`
	UpdatedAt      *time.Time     `json:"updatedAt,omitempty"`
}

// QueryFilter captures normalized filters plus optional metadata filters.
type QueryFilter struct {
	TenantID       string
	ProjectID      string
	ProfileIDs     []string
	SourceFamily   string
	ArtifactID     string
	RunID          string
	SinkEndpointID string
	DatasetSlug    string
	EntityKinds    []string
	Labels         []string
	Tags           []string
	MetadataEQ     map[string]any // exact match on metadata fields
	SinceUpdatedAt *time.Time
	Limit          int
}

// Store defines the minimal operations a vector store must support.
type Store interface {
	// UpsertEntries inserts or updates entries (embedding included).
	UpsertEntries(entries []Entry) error

	// Query performs a similarity search with filters and returns node IDs with scores and payload.
	Query(embedding []float32, filter QueryFilter, topK int) ([]SearchResult, error)

	// DeleteByArtifact removes entries produced by a specific artifact/run.
	DeleteByArtifact(tenantID, artifactID, runID string) error

	// ListEntries returns recent entries matching the filter (e.g., for clustering seeds).
	// Implementations should return entries sorted by updated_at DESC when possible.
	ListEntries(filter QueryFilter, limit int) ([]Entry, error)
}

// SearchResult captures a match returned by the store.
type SearchResult struct {
	NodeID      string
	ProfileID   string
	Score       float32
	ContentText string
	Metadata    map[string]any
	RawMetadata map[string]any
	RawPayload  map[string]any
}
