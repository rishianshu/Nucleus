// Package graph provides additional GraphQL model types.
package graph

import (
	"encoding/json"
	"time"
)

// =============================================================================
// COLLECTION TYPES
// =============================================================================

// MetadataCollection represents a collection.
type MetadataCollection struct {
	ID                 string     `json:"id"`
	EndpointID         string     `json:"endpointId"`
	Endpoint           *MetadataEndpoint `json:"endpoint,omitempty"`
	ScheduleCron       *string    `json:"scheduleCron,omitempty"`
	ScheduleTimezone   *string    `json:"scheduleTimezone,omitempty"`
	IsEnabled          bool       `json:"isEnabled"`
	TemporalScheduleID *string    `json:"temporalScheduleId,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

// MetadataCollectionRun represents a collection run.
type MetadataCollectionRun struct {
	ID            string                      `json:"id"`
	CollectionID  *string                     `json:"collectionId,omitempty"`
	Collection    *MetadataCollection         `json:"collection,omitempty"`
	EndpointID    string                      `json:"endpointId"`
	Endpoint      *MetadataEndpoint           `json:"endpoint,omitempty"`
	Status        MetadataCollectionStatus    `json:"status"`
	RequestedBy   *string                     `json:"requestedBy,omitempty"`
	RequestedAt   time.Time                   `json:"requestedAt"`
	StartedAt     *time.Time                  `json:"startedAt,omitempty"`
	CompletedAt   *time.Time                  `json:"completedAt,omitempty"`
	WorkflowID    *string                     `json:"workflowId,omitempty"`
	TemporalRunID *string                     `json:"temporalRunId,omitempty"`
	Error         *string                     `json:"error,omitempty"`
	Filters       json.RawMessage             `json:"filters,omitempty"`
}

// MetadataCollectionStatus represents run status.
type MetadataCollectionStatus string

const (
	CollectionStatusQueued    MetadataCollectionStatus = "QUEUED"
	CollectionStatusRunning   MetadataCollectionStatus = "RUNNING"
	CollectionStatusSucceeded MetadataCollectionStatus = "SUCCEEDED"
	CollectionStatusFailed    MetadataCollectionStatus = "FAILED"
	CollectionStatusSkipped   MetadataCollectionStatus = "SKIPPED"
)

// CollectionCreateInput is the input for creating a collection.
type CollectionCreateInput struct {
	EndpointID       string  `json:"endpointId"`
	ScheduleCron     *string `json:"scheduleCron,omitempty"`
	ScheduleTimezone *string `json:"scheduleTimezone,omitempty"`
	IsEnabled        *bool   `json:"isEnabled,omitempty"`
}

// CollectionUpdateInput is the input for updating a collection.
type CollectionUpdateInput struct {
	ScheduleCron     *string `json:"scheduleCron,omitempty"`
	ScheduleTimezone *string `json:"scheduleTimezone,omitempty"`
	IsEnabled        *bool   `json:"isEnabled,omitempty"`
}

// =============================================================================
// INGESTION TYPES
// =============================================================================

// IngestionState represents ingestion state.
type IngestionState string

const (
	IngestionStateIdle      IngestionState = "IDLE"
	IngestionStateRunning   IngestionState = "RUNNING"
	IngestionStatePaused    IngestionState = "PAUSED"
	IngestionStateFailed    IngestionState = "FAILED"
	IngestionStateSucceeded IngestionState = "SUCCEEDED"
)

// IngestionStatus represents ingestion status.
type IngestionStatus struct {
	EndpointID string          `json:"endpointId"`
	UnitID     string          `json:"unitId"`
	SinkID     string          `json:"sinkId"`
	State      IngestionState  `json:"state"`
	LastRunID  *string         `json:"lastRunId,omitempty"`
	LastRunAt  *time.Time      `json:"lastRunAt,omitempty"`
	LastError  *string         `json:"lastError,omitempty"`
	Stats      json.RawMessage `json:"stats,omitempty"`
	Checkpoint json.RawMessage `json:"checkpoint,omitempty"`
}

// IngestionActionResult is the result of an ingestion action.
type IngestionActionResult struct {
	OK      bool           `json:"ok"`
	RunID   *string        `json:"runId,omitempty"`
	State   IngestionState `json:"state,omitempty"`
	Message *string        `json:"message,omitempty"`
}

// IngestionUnitConfig represents ingestion unit configuration.
type IngestionUnitConfig struct {
	ID                      string          `json:"id"`
	EndpointID              string          `json:"endpointId"`
	DatasetID               string          `json:"datasetId"`
	UnitID                  string          `json:"unitId"`
	Enabled                 bool            `json:"enabled"`
	RunMode                 string          `json:"runMode"`
	Mode                    string          `json:"mode"`
	SinkID                  string          `json:"sinkId"`
	SinkEndpointID          *string         `json:"sinkEndpointId,omitempty"`
	ScheduleKind            string          `json:"scheduleKind"`
	ScheduleIntervalMinutes *int            `json:"scheduleIntervalMinutes,omitempty"`
	Policy                  json.RawMessage `json:"policy,omitempty"`
	LastStatus              *IngestionStatus `json:"lastStatus,omitempty"`
}

// IngestionUnitConfigInput is input for configuring ingestion.
type IngestionUnitConfigInput struct {
	EndpointID              string          `json:"endpointId"`
	UnitID                  string          `json:"unitId"`
	Enabled                 *bool           `json:"enabled,omitempty"`
	RunMode                 *string         `json:"runMode,omitempty"`
	Mode                    *string         `json:"mode,omitempty"`
	SinkID                  *string         `json:"sinkId,omitempty"`
	SinkEndpointID          *string         `json:"sinkEndpointId,omitempty"`
	ScheduleKind            *string         `json:"scheduleKind,omitempty"`
	ScheduleIntervalMinutes *int            `json:"scheduleIntervalMinutes,omitempty"`
	Policy                  json.RawMessage `json:"policy,omitempty"`
}

// =============================================================================
// CATALOG TYPES
// =============================================================================

// CatalogDataset represents a catalog dataset.
type CatalogDataset struct {
	ID               string                 `json:"id"`
	UpstreamID       *string                `json:"upstreamId,omitempty"`
	DisplayName      string                 `json:"displayName"`
	Description      *string                `json:"description,omitempty"`
	Source           *string                `json:"source,omitempty"`
	ProjectIDs       []string               `json:"projectIds,omitempty"`
	Labels           []string               `json:"labels,omitempty"`
	Schema           *string                `json:"schema,omitempty"`
	Entity           *string                `json:"entity,omitempty"`
	CollectedAt      *time.Time             `json:"collectedAt,omitempty"`
	SourceEndpointID *string                `json:"sourceEndpointId,omitempty"`
	SourceEndpoint   *MetadataEndpoint      `json:"sourceEndpoint,omitempty"`
	Fields           []*CatalogDatasetField `json:"fields"`
}

// CatalogDatasetField represents a field in a dataset.
type CatalogDatasetField struct {
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Description *string `json:"description,omitempty"`
}

// =============================================================================
// ENDPOINT TEMPLATE TYPES
// =============================================================================

// MetadataEndpointFamily represents endpoint family.
type MetadataEndpointFamily string

const (
	EndpointFamilyJDBC   MetadataEndpointFamily = "JDBC"
	EndpointFamilyHTTP   MetadataEndpointFamily = "HTTP"
	EndpointFamilySTREAM MetadataEndpointFamily = "STREAM"
)

// MetadataEndpointTemplate represents an endpoint template.
type MetadataEndpointTemplate struct {
	ID          string                 `json:"id"`
	Family      MetadataEndpointFamily `json:"family"`
	Title       string                 `json:"title"`
	Vendor      string                 `json:"vendor"`
	Description *string                `json:"description,omitempty"`
	Categories  []string               `json:"categories"`
	Fields      []*MetadataEndpointField `json:"fields,omitempty"`
}

// MetadataEndpointField represents a template field.
type MetadataEndpointField struct {
	Key          string  `json:"key"`
	Label        string  `json:"label"`
	Required     bool    `json:"required"`
	ValueType    string  `json:"valueType"`
	Description  *string `json:"description,omitempty"`
	DefaultValue *string `json:"defaultValue,omitempty"`
	Sensitive    bool    `json:"sensitive"`
}
