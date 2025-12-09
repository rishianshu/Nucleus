// Package database provides database models matching the Prisma schema.
package database

import (
	"database/sql"
	"encoding/json"
	"time"
)

// =============================================================================
// CORE METADATA MODELS
// =============================================================================

// MetadataProject represents a project in the metadata system.
type MetadataProject struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	DisplayName string         `json:"displayName"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// MetadataRecord represents a metadata record stored in the system.
type MetadataRecord struct {
	ID        string          `json:"id"`
	ProjectID string          `json:"projectId"`
	Domain    string          `json:"domain"`
	Labels    []string        `json:"labels"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// MetadataEndpoint represents a registered data source endpoint.
type MetadataEndpoint struct {
	ID                 string          `json:"id"`
	SourceID           sql.NullString  `json:"sourceId"`
	ProjectID          sql.NullString  `json:"projectId"`
	Name               string          `json:"name"`
	Description        sql.NullString  `json:"description"`
	Verb               string          `json:"verb"`
	URL                string          `json:"url"`
	AuthPolicy         sql.NullString  `json:"authPolicy"`
	Domain             sql.NullString  `json:"domain"`
	Labels             []string        `json:"labels"`
	Config             json.RawMessage `json:"config"`
	DetectedVersion    sql.NullString  `json:"detectedVersion"`
	VersionHint        sql.NullString  `json:"versionHint"`
	Capabilities       []string        `json:"capabilities"`
	DelegatedConnected bool            `json:"delegatedConnected"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
	DeletedAt          sql.NullTime    `json:"deletedAt"`
	DeletionReason     sql.NullString  `json:"deletionReason"`
}

// =============================================================================
// COLLECTION MODELS
// =============================================================================

// MetadataCollection represents a collection configuration.
type MetadataCollection struct {
	ID                 string         `json:"id"`
	EndpointID         string         `json:"endpointId"`
	ScheduleCron       sql.NullString `json:"scheduleCron"`
	ScheduleTimezone   string         `json:"scheduleTimezone"`
	IsEnabled          bool           `json:"isEnabled"`
	TemporalScheduleID sql.NullString `json:"temporalScheduleId"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
}

// MetadataCollectionRunStatus represents the status of a collection run.
type MetadataCollectionRunStatus string

const (
	CollectionStatusQueued    MetadataCollectionRunStatus = "QUEUED"
	CollectionStatusRunning   MetadataCollectionRunStatus = "RUNNING"
	CollectionStatusSucceeded MetadataCollectionRunStatus = "SUCCEEDED"
	CollectionStatusFailed    MetadataCollectionRunStatus = "FAILED"
	CollectionStatusSkipped   MetadataCollectionRunStatus = "SKIPPED"
)

// MetadataCollectionRun represents a single execution of a collection.
type MetadataCollectionRun struct {
	ID            string                      `json:"id"`
	EndpointID    string                      `json:"endpointId"`
	CollectionID  sql.NullString              `json:"collectionId"`
	Status        MetadataCollectionRunStatus `json:"status"`
	RequestedBy   sql.NullString              `json:"requestedBy"`
	RequestedAt   time.Time                   `json:"requestedAt"`
	StartedAt     sql.NullTime                `json:"startedAt"`
	CompletedAt   sql.NullTime                `json:"completedAt"`
	WorkflowID    sql.NullString              `json:"workflowId"`
	TemporalRunID sql.NullString              `json:"temporalRunId"`
	Error         sql.NullString              `json:"error"`
	Filters       json.RawMessage             `json:"filters"`
}

// =============================================================================
// INGESTION MODELS
// =============================================================================

// IngestionUnitConfig represents configuration for an ingestion unit.
type IngestionUnitConfig struct {
	ID                      string          `json:"id"`
	EndpointID              string          `json:"endpointId"`
	DatasetID               string          `json:"datasetId"`
	UnitID                  string          `json:"unitId"`
	Enabled                 bool            `json:"enabled"`
	RunMode                 string          `json:"runMode"`
	Mode                    string          `json:"mode"`
	SinkID                  string          `json:"sinkId"`
	SinkEndpointID          sql.NullString  `json:"sinkEndpointId"`
	ScheduleKind            string          `json:"scheduleKind"`
	ScheduleIntervalMinutes sql.NullInt32   `json:"scheduleIntervalMinutes"`
	Policy                  json.RawMessage `json:"policy"`
	Filter                  json.RawMessage `json:"filter"`
	CreatedAt               time.Time       `json:"createdAt"`
	UpdatedAt               time.Time       `json:"updatedAt"`
}

// IngestionState represents the state of an ingestion unit.
type IngestionState string

const (
	IngestionStateIdle      IngestionState = "IDLE"
	IngestionStateRunning   IngestionState = "RUNNING"
	IngestionStatePaused    IngestionState = "PAUSED"
	IngestionStateFailed    IngestionState = "FAILED"
	IngestionStateSucceeded IngestionState = "SUCCEEDED"
)

// IngestionUnitState represents the runtime state of an ingestion unit.
type IngestionUnitState struct {
	ID         string          `json:"id"`
	EndpointID string          `json:"endpointId"`
	UnitID     string          `json:"unitId"`
	SinkID     string          `json:"sinkId"`
	State      IngestionState  `json:"state"`
	LastRunID  sql.NullString  `json:"lastRunId"`
	LastRunAt  sql.NullTime    `json:"lastRunAt"`
	LastError  sql.NullString  `json:"lastError"`
	Stats      json.RawMessage `json:"stats"`
	Checkpoint json.RawMessage `json:"checkpoint"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

// IngestionCheckpoint represents checkpoint data for resumable ingestion.
type IngestionCheckpoint struct {
	ID         string          `json:"id"`
	EndpointID string          `json:"endpointId"`
	UnitID     string          `json:"unitId"`
	SinkID     string          `json:"sinkId"`
	Vendor     string          `json:"vendor"`
	Version    int             `json:"version"`
	Data       json.RawMessage `json:"data"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

// TransientState represents temporary runtime state for ingestion.
type TransientState struct {
	ID         string          `json:"id"`
	EndpointID string          `json:"endpointId"`
	UnitID     string          `json:"unitId"`
	SinkID     string          `json:"sinkId"`
	Version    int             `json:"version"`
	State      json.RawMessage `json:"state"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

// =============================================================================
// GRAPH MODELS (Knowledge Base)
// =============================================================================

// GraphScope represents the scope of a graph entity.
type GraphScope struct {
	OrgID     string  `json:"orgId"`
	ProjectID *string `json:"projectId,omitempty"`
	DomainID  *string `json:"domainId,omitempty"`
	TeamID    *string `json:"teamId,omitempty"`
}

// GraphIdentity represents the identity metadata of a graph entity.
type GraphIdentity struct {
	LogicalKey       string          `json:"logicalKey"`
	ExternalID       json.RawMessage `json:"externalId,omitempty"`
	OriginEndpointID *string         `json:"originEndpointId,omitempty"`
	OriginVendor     *string         `json:"originVendor,omitempty"`
	Phase            *string         `json:"phase,omitempty"`
	Provenance       json.RawMessage `json:"provenance,omitempty"`
	SourceLogicalKey *string         `json:"sourceLogicalKey,omitempty"`
	TargetLogicalKey *string         `json:"targetLogicalKey,omitempty"`
}

// GraphNode represents a node in the knowledge graph.
type GraphNode struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenantId"`
	ProjectID     sql.NullString  `json:"projectId"`
	EntityType    string          `json:"entityType"`
	DisplayName   string          `json:"displayName"`
	CanonicalPath sql.NullString  `json:"canonicalPath"`
	SourceSystem  sql.NullString  `json:"sourceSystem"`
	SpecRef       sql.NullString  `json:"specRef"`
	Properties    json.RawMessage `json:"properties"`
	Version       int             `json:"version"`
	Phase         sql.NullString  `json:"phase"`
	LogicalKey    string          `json:"logicalKey"`
	ExternalID    json.RawMessage `json:"externalId"`
	Provenance    json.RawMessage `json:"provenance"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// GraphEdge represents an edge in the knowledge graph.
type GraphEdge struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenantId"`
	ProjectID      sql.NullString  `json:"projectId"`
	EdgeType       string          `json:"edgeType"`
	SourceEntityID string          `json:"sourceEntityId"`
	TargetEntityID string          `json:"targetEntityId"`
	Confidence     sql.NullFloat64 `json:"confidence"`
	SpecRef        sql.NullString  `json:"specRef"`
	Metadata       json.RawMessage `json:"metadata"`
	LogicalKey     string          `json:"logicalKey"`
	SourceLogical  string          `json:"sourceLogicalKey"`
	TargetLogical  string          `json:"targetLogicalKey"`
	Provenance     json.RawMessage `json:"provenance"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// =============================================================================
// ENDPOINT TEMPLATE MODELS
// =============================================================================

// EndpointTemplate represents a template for creating endpoints.
type EndpointTemplate struct {
	ID                string          `json:"id"`
	Family            string          `json:"family"`
	Title             string          `json:"title"`
	Vendor            string          `json:"vendor"`
	Description       sql.NullString  `json:"description"`
	Domain            sql.NullString  `json:"domain"`
	Categories        []string        `json:"categories"`
	Protocols         []string        `json:"protocols"`
	Versions          []string        `json:"versions"`
	DefaultPort       sql.NullInt32   `json:"defaultPort"`
	Driver            sql.NullString  `json:"driver"`
	DocsURL           sql.NullString  `json:"docsUrl"`
	AgentPrompt       sql.NullString  `json:"agentPrompt"`
	DefaultLabels     []string        `json:"defaultLabels"`
	Fields            json.RawMessage `json:"fields"`
	Capabilities      json.RawMessage `json:"capabilities"`
	SampleConfig      json.RawMessage `json:"sampleConfig"`
	Connection        json.RawMessage `json:"connection"`
	DescriptorVersion sql.NullString  `json:"descriptorVersion"`
	MinVersion        sql.NullString  `json:"minVersion"`
	MaxVersion        sql.NullString  `json:"maxVersion"`
	Probing           json.RawMessage `json:"probing"`
	Extras            json.RawMessage `json:"extras"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

// =============================================================================
// OAUTH SESSION MODELS
// =============================================================================

// OneDriveAuthSession represents an active OneDrive OAuth session.
type OneDriveAuthSession struct {
	ID           string         `json:"id"`
	EndpointID   string         `json:"endpointId"`
	State        string         `json:"state"`
	CodeVerifier sql.NullString `json:"codeVerifier"`
	CreatedAt    time.Time      `json:"createdAt"`
	ExpiresAt    time.Time      `json:"expiresAt"`
}

// OneDriveDelegatedToken represents a stored OneDrive OAuth token.
type OneDriveDelegatedToken struct {
	ID           string    `json:"id"`
	EndpointID   string    `json:"endpointId"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
