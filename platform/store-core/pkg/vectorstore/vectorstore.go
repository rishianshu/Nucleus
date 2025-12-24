package vectorstore

import "time"

// Entry represents a normalized vector document ready for embedding/indexing.
type Entry struct {
	TenantID       string
	ProjectID      string
	ProfileID      string
	NodeID         string
	SourceFamily   string
	ArtifactID     string
	RunID          string
	SinkEndpointID string
	DatasetSlug    string
	EntityKind     string
	Labels         []string
	Tags           []string
	ContentText    string
	Metadata       map[string]any
	RawPayload     map[string]any
	RawMetadata    map[string]any
	Embedding      []float32
	UpdatedAt      *time.Time
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
	MetadataEQ     map[string]any
	SinceUpdatedAt *time.Time
	Limit          int
}

// Store defines the minimal operations a vector store must support.
type Store interface {
	UpsertEntries(entries []Entry) error
	Query(embedding []float32, filter QueryFilter, topK int) ([]SearchResult, error)
	DeleteByArtifact(tenantID, artifactID, runID string) error
	ListEntries(filter QueryFilter, limit int) ([]Entry, error)
	Close() error
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
