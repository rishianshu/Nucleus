// Package endpoint defines the core interfaces that all UCL connectors must implement.
//
// Architecture:
//
//	Endpoint        - Base contract (ID, Validate, Capabilities, Descriptor)
//	SourceEndpoint  - Read data (ListDatasets, GetSchema, Read)
//	SinkEndpoint    - Write data (WriteRaw, Finalize, Watermark)
//	ActionEndpoint  - Control-plane actions (ListActions, Execute)
//
// All endpoints must implement the base Endpoint interface. Connectors then
// compose additional interfaces based on their capabilities.
package endpoint

import "context"

// Endpoint is the base contract that ALL UCL connectors must implement.
type Endpoint interface {
	// ID returns the unique template identifier (e.g., "jdbc.postgres", "http.jira").
	ID() string

	// ValidateConfig tests configuration validity and connectivity.
	ValidateConfig(ctx context.Context, config map[string]any) (*ValidationResult, error)

	// GetCapabilities returns the set of supported operations.
	GetCapabilities() *Capabilities

	// GetDescriptor returns metadata about this endpoint type.
	GetDescriptor() *Descriptor

	// Close releases any resources held by the endpoint.
	Close() error
}

// SourceEndpoint can read data from an external system.
type SourceEndpoint interface {
	Endpoint

	// ListDatasets returns available datasets/tables/collections.
	ListDatasets(ctx context.Context) ([]*Dataset, error)

	// GetSchema returns the schema for a specific dataset.
	GetSchema(ctx context.Context, datasetID string) (*Schema, error)

	// Read streams records from a dataset.
	// Returns an Iterator that must be closed after use.
	Read(ctx context.Context, req *ReadRequest) (Iterator[Record], error)
}

// SinkEndpoint can write data to an external system.
type SinkEndpoint interface {
	Endpoint

	// WriteRaw writes records to the sink.
	WriteRaw(ctx context.Context, req *WriteRequest) (*WriteResult, error)

	// Finalize completes a write operation (e.g., moves staged files to final location).
	Finalize(ctx context.Context, datasetID string, loadDate string) (*FinalizeResult, error)

	// GetLatestWatermark returns the last committed watermark for incremental syncs.
	GetLatestWatermark(ctx context.Context, datasetID string) (string, error)
}

// ActionEndpoint can execute control-plane actions.
type ActionEndpoint interface {
	Endpoint

	// ListActions returns available actions for this endpoint.
	ListActions(ctx context.Context) ([]*ActionDescriptor, error)

	// GetActionSchema returns the input/output schema for an action.
	GetActionSchema(ctx context.Context, actionID string) (*ActionSchema, error)

	// ExecuteAction runs an action with the given parameters.
	ExecuteAction(ctx context.Context, req *ActionRequest) (*ActionResult, error)
}

// DataEndpoint supports both source and sink operations.
type DataEndpoint interface {
	SourceEndpoint
	SinkEndpoint
}
