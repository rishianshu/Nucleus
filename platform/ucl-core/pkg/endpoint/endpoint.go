// Package endpoint provides public API for UCL endpoints.
package endpoint

import (
	internal "github.com/nucleus/ucl-core/internal/endpoint"
)

// Re-export types for external use
type (
	Record               = internal.Record
	Iterator[T any]      = internal.Iterator[T]
	Endpoint             = internal.Endpoint
	SourceEndpoint       = internal.SourceEndpoint
	SinkEndpoint         = internal.SinkEndpoint
	SliceCapable         = internal.SliceCapable
	Dataset              = internal.Dataset
	Schema               = internal.Schema
	FieldDefinition      = internal.FieldDefinition
	Capabilities         = internal.Capabilities
	CapabilityDescriptor = internal.CapabilityDescriptor
	Checkpoint           = internal.Checkpoint
	IngestionPlan        = internal.IngestionPlan
	IngestionSlice       = internal.IngestionSlice
	WriteRequest         = internal.WriteRequest
	WriteResult          = internal.WriteResult
	FinalizeResult       = internal.FinalizeResult
	PlanRequest          = internal.PlanRequest
	ReadRequest          = internal.ReadRequest
	SliceReadRequest     = internal.SliceReadRequest
	ValidationResult     = internal.ValidationResult
	Descriptor           = internal.Descriptor
	AuthDescriptor       = internal.AuthDescriptor
	AuthModeDescriptor   = internal.AuthModeDescriptor
	FieldDescriptor      = internal.FieldDescriptor
	Factory              = internal.Factory
	Registry             = internal.Registry
	AdaptiveIngestion    = internal.AdaptiveIngestion
	ProbeRequest         = internal.ProbeRequest
	ProbeResult          = internal.ProbeResult
	PlanIngestionRequest = internal.PlanIngestionRequest
	CDMRegistry          = internal.CDMRegistry
	CDMMapping           = internal.CDMMapping
	CDMMapperFunc        = internal.CDMMapperFunc

	// Discovery types for hybrid NER/EPP
	Mention            = internal.Mention
	Relation           = internal.Relation
	Entity             = internal.Entity
	MentionExtractor   = internal.MentionExtractor
	RelationExtractor  = internal.RelationExtractor
	EntityMapper       = internal.EntityMapper
	DiscoveryRegistry  = internal.DiscoveryRegistry
	RelationDirection  = internal.RelationDirection
	EntityType         = internal.EntityType

	// Phase 3: Entity Resolution & Temporal Tracking
	EntityResolver           = internal.EntityResolver
	MatchRule                = internal.MatchRule
	RelationEvent            = internal.RelationEvent
	RelationEventType        = internal.RelationEventType
	RelationEventProcessor   = internal.RelationEventProcessor
	EdgeKey                  = internal.EdgeKey
)

// Strategy type for ingestion planning
type Strategy string

const (
	StrategyFull        Strategy = "full"
	StrategyIncremental Strategy = "incremental"
	StrategyAdaptive    Strategy = "adaptive"
)

// RelationEventType constants for temporal tracking
const (
	RelationEventCreated  = internal.RelationEventCreated
	RelationEventUpdated  = internal.RelationEventUpdated
	RelationEventExpired  = internal.RelationEventExpired
	RelationEventReassign = internal.RelationEventReassign
)

// NewRelationEventProcessor creates a new SCD2-style relation event processor.
func NewRelationEventProcessor() *internal.DefaultRelationEventProcessor {
	return internal.NewRelationEventProcessor()
}

// DefaultRegistry returns the default endpoint registry.
func DefaultRegistry() *internal.Registry {
	return internal.DefaultRegistry()
}

// Create creates an endpoint from the registry by ID.
func Create(endpointID string, config map[string]any) (Endpoint, error) {
	factory, ok := DefaultRegistry().Get(endpointID)
	if !ok || factory == nil {
		return nil, ErrNotFound{EndpointID: endpointID}
	}
	// Factory is a function type, call it directly
	return factory(config)
}

// CreateSource creates a source endpoint.
func CreateSource(endpointID string, config map[string]any) (SourceEndpoint, error) {
	ep, err := Create(endpointID, config)
	if err != nil {
		return nil, err
	}
	source, ok := ep.(SourceEndpoint)
	if !ok {
		return nil, ErrNotSource{EndpointID: endpointID}
	}
	return source, nil
}

// CreateSliceCapable creates a slice-capable endpoint.
func CreateSliceCapable(endpointID string, config map[string]any) (SliceCapable, error) {
	ep, err := Create(endpointID, config)
	if err != nil {
		return nil, err
	}
	sliceCapable, ok := ep.(SliceCapable)
	if !ok {
		return nil, ErrNotSliceCapable{EndpointID: endpointID}
	}
	return sliceCapable, nil
}

// Register adds a factory to the default registry.
func Register(endpointID string, factory Factory) {
	DefaultRegistry().Register(endpointID, factory)
}

// DefaultCDMRegistry exposes the global CDM registry.
func DefaultCDMRegistry() *internal.CDMRegistry {
	return internal.DefaultCDMRegistry()
}

// RegisterCDM adds CDM mappings to the global registry.
func RegisterCDM(endpointID string, mappings []internal.CDMMapping) {
	internal.RegisterCDM(endpointID, mappings)
}

// DefaultDiscoveryRegistry returns the global discovery registry.
// P2 Fix: Export accessor for external packages to register extractors.
func DefaultDiscoveryRegistry() *DiscoveryRegistry {
	return internal.DefaultDiscoveryRegistry()
}

// RegisterCDMMapper registers a mapper for a dataset in the global registry.
func RegisterCDMMapper(datasetID string, mapper internal.CDMMapperFunc) {
	internal.RegisterCDMMapper(datasetID, mapper)
}

// ErrNotFound indicates an endpoint was not found.
type ErrNotFound struct {
	EndpointID string
}

func (e ErrNotFound) Error() string {
	return "endpoint not found: " + e.EndpointID
}

// ErrNotSource indicates an endpoint doesn't support source operations.
type ErrNotSource struct {
	EndpointID string
}

func (e ErrNotSource) Error() string {
	return "endpoint does not support source operations: " + e.EndpointID
}

// ErrNotSliceCapable indicates an endpoint doesn't support slice operations.
type ErrNotSliceCapable struct {
	EndpointID string
}

func (e ErrNotSliceCapable) Error() string {
	return "endpoint does not support slice operations: " + e.EndpointID
}
