package core

// =============================================================================
// INGESTION REQUEST/RESULT MODELS
// Request and response types for ingestion operations.
// =============================================================================

// CollectionJobRequest triggers a metadata collection run.
type CollectionJobRequest struct {
	RunID         string
	EndpointID    string
	SourceID      string
	EndpointName  string
	ConnectionURL string
	Schemas       []string
	ProjectID     string
	Labels        []string
	Config        map[string]any
}

// CollectionJobResult contains collection run outcome.
type CollectionJobResult struct {
	RecordsPath string
	RecordCount int
	Logs        []map[string]any
}

// CatalogRecordOutput represents a catalog record for output.
type CatalogRecordOutput struct {
	ID        string
	ProjectID string
	Domain    string
	Labels    []string
	Payload   map[string]any
}

// PreviewRequest requests a dataset preview.
type PreviewRequest struct {
	DatasetID     string
	Schema        string
	Table         string
	EndpointID    string
	UnitID        string
	TemplateID    string
	Parameters    map[string]any
	ConnectionURL string
	Limit         int
}

// IngestionUnitRequest triggers an ingestion unit run.
type IngestionUnitRequest struct {
	EndpointID            string
	UnitID                string
	SinkID                string
	Checkpoint            map[string]any
	StagingProviderID     string
	Policy                map[string]any
	Mode                  string
	DataMode              string
	SinkEndpointID        string
	CdmModelID            string
	Filter                map[string]any
	TransientState        map[string]any
	TransientStateVersion string
}

// IngestionUnitResult contains ingestion run outcome.
type IngestionUnitResult struct {
	NewCheckpoint     map[string]any
	Stats             map[string]any
	Records           []map[string]any
	TransientState    map[string]any
	StagingPath       string
	StagingProviderID string
	Staging           []map[string]any
	StageRef          string
	BatchRefs         []string
	BytesStaged       int64
	RecordsStaged     int64
}
