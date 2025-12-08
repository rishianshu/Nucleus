package core

import "context"

// =============================================================================
// METADATA PROTOCOLS
// These interfaces define the metadata pipeline contracts.
// =============================================================================

// MetadataEmitter emits records to the metadata pipeline.
type MetadataEmitter interface {
	Emit(ctx context.Context, context MetadataContext, record *MetadataRecord) error
	EmitMany(ctx context.Context, context MetadataContext, records []*MetadataRecord) error
}

// MetadataRepository stores and queries metadata records.
type MetadataRepository interface {
	Store(ctx context.Context, record *MetadataRecord) (*MetadataRecord, error)
	BulkStore(ctx context.Context, records []*MetadataRecord) ([]*MetadataRecord, error)
	Latest(ctx context.Context, target MetadataTarget, kind string) (*MetadataRecord, error)
	History(ctx context.Context, target MetadataTarget, kind string, limit int) ([]*MetadataRecord, error)
	Query(ctx context.Context, criteria MetadataQuery) ([]*MetadataRecord, error)
}

// MetadataProducer produces metadata records from a source.
type MetadataProducer interface {
	ProducerID() string
	Capabilities() map[string]any
	Supports(request *MetadataRequest) bool
	Produce(ctx context.Context, request *MetadataRequest) ([]*MetadataRecord, error)
}

// MetadataConsumer consumes metadata records.
type MetadataConsumer interface {
	ConsumerID() string
	Requirements() map[string]any
	Consume(ctx context.Context, records []*MetadataRecord, context MetadataContext) error
}

// MetadataTransformer transforms metadata records in the pipeline.
type MetadataTransformer interface {
	AppliesTo(record *MetadataRecord) bool
	Transform(ctx context.Context, record *MetadataRecord, context MetadataContext) (*MetadataRecord, error)
}
