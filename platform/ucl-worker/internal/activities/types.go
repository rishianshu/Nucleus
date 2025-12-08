// Package activities provides Temporal activity implementations for UCL connectors.
package activities

// CollectionJobRequest matches Python ingestion_models.requests.CollectionJobRequest
type CollectionJobRequest struct {
	RunID        string            `json:"runId"`
	EndpointID   string            `json:"endpointId"`
	SourceID     string            `json:"sourceId"`
	EndpointName string            `json:"endpointName"`
	ConnectionURL string           `json:"connectionUrl"`
	Schemas      []string          `json:"schemas,omitempty"`
	ProjectID    string            `json:"projectId,omitempty"`
	Labels       []string          `json:"labels,omitempty"`
	Config       map[string]any    `json:"config,omitempty"`
}

// CollectionResult matches Python CollectionJobResult
type CollectionResult struct {
	Records     []CatalogRecord `json:"records,omitempty"`
	RecordsPath string          `json:"recordsPath,omitempty"`
	RecordCount int             `json:"recordCount"`
	Logs        []LogEntry      `json:"logs,omitempty"`
}

// CatalogRecord matches Python CatalogRecordOutput
type CatalogRecord struct {
	ID        string         `json:"id"`
	ProjectID string         `json:"projectId,omitempty"`
	Domain    string         `json:"domain"`
	Labels    []string       `json:"labels,omitempty"`
	Payload   map[string]any `json:"payload"`
}

// LogEntry for activity logging
type LogEntry struct {
	Level   string         `json:"level"`
	Message string         `json:"message,omitempty"`
	Fields  map[string]any `json:"fields,omitempty"`
}

// PreviewRequest matches workflow previewDataset input
type PreviewRequest struct {
	DatasetID         string         `json:"datasetId"`
	EndpointID        string         `json:"endpointId"`
	UnitID            string         `json:"unitId"`
	Schema            string         `json:"schema"`
	Table             string         `json:"table"`
	Limit             int            `json:"limit,omitempty"`
	TemplateID        string         `json:"templateId"`
	Parameters        map[string]any `json:"parameters,omitempty"`
	ConnectionURL     string         `json:"connectionUrl,omitempty"`
	StagingProviderID string         `json:"stagingProviderId,omitempty"`
}

// PreviewResult matches workflow preview output
type PreviewResult struct {
	Rows              []map[string]any `json:"rows,omitempty"`
	SampledAt         string           `json:"sampledAt"`
	RecordsPath       string           `json:"recordsPath,omitempty"`
	StagingProviderID string           `json:"stagingProviderId,omitempty"`
}

// IngestionRequest matches Python IngestionUnitRequest
type IngestionRequest struct {
	EndpointID            string         `json:"endpointId"`
	UnitID                string         `json:"unitId"`
	SinkID                string         `json:"sinkId,omitempty"`
	Checkpoint            map[string]any `json:"checkpoint,omitempty"`
	StagingProviderID     string         `json:"stagingProviderId,omitempty"`
	Policy                map[string]any `json:"policy,omitempty"`
	Mode                  string         `json:"mode,omitempty"` // FULL, INCREMENTAL, PREVIEW
	DataMode              string         `json:"dataMode,omitempty"`
	CDMModelID            string         `json:"cdmModelId,omitempty"`
	Filter                map[string]any `json:"filter,omitempty"`
	TransientState        map[string]any `json:"transientState,omitempty"`
	TransientStateVersion string         `json:"transientStateVersion,omitempty"`
	Slice                 map[string]any `json:"slice,omitempty"` // Slice info for fan-out
	SliceIndex            *int           `json:"slice_index,omitempty"`
}

// IngestionResult matches Python IngestionUnitResult
type IngestionResult struct {
	NewCheckpoint     any              `json:"newCheckpoint,omitempty"`
	Stats             map[string]any   `json:"stats,omitempty"`
	Records           []map[string]any `json:"records,omitempty"` // Only in PREVIEW mode
	TransientState    map[string]any   `json:"transientState,omitempty"`
	Staging           []StagingHandle  `json:"staging,omitempty"`
	StagingPath       string           `json:"stagingPath,omitempty"`
	StagingProviderID string           `json:"stagingProviderId,omitempty"`
}

// StagingHandle represents a staged file reference
type StagingHandle struct {
	Path       string `json:"path"`
	ProviderID string `json:"providerId,omitempty"`
}

// PlanResult matches Python planIngestionUnit output
type PlanResult struct {
	Slices       []SliceDescriptor  `json:"slices,omitempty"`
	PlanMetadata map[string]any     `json:"plan_metadata,omitempty"`
	Strategy     string             `json:"strategy,omitempty"`
}

// SliceDescriptor matches Python serialized slice
type SliceDescriptor struct {
	SliceKey string         `json:"slice_key"`
	Sequence int            `json:"sequence"`
	Lower    string         `json:"lower,omitempty"`
	Upper    string         `json:"upper,omitempty"`
	Params   map[string]any `json:"params,omitempty"`
}
