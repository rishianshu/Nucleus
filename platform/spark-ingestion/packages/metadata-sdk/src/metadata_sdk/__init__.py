"""Public exports for the metadata SDK."""

from .client import MetadataSDK, MetadataClient
from .models import (
    BaseRecord,
    DataVolumeMetric,
    RuntimeMetric,
    SchemaProfile,
    build_custom_record,
)
from .transports import Transport, EmbeddedTransport
from .emitters import GraphQLMetadataEmitter
from .types import MetadataContext, MetadataRecord, MetadataTarget
from .schema import (
    SchemaDriftPolicy,
    SchemaDriftResult,
    SchemaDriftValidator,
    SchemaSnapshot,
    SchemaSnapshotColumn,
    SchemaValidationError,
    build_schema_snapshot,
)

__all__ = [
    "MetadataSDK",
    "MetadataClient",
    "BaseRecord",
    "DataVolumeMetric",
    "RuntimeMetric",
    "SchemaProfile",
    "build_custom_record",
    "GraphQLMetadataEmitter",
    "Transport",
    "EmbeddedTransport",
    "MetadataContext",
    "MetadataRecord",
    "MetadataTarget",
    "SchemaDriftPolicy",
    "SchemaDriftResult",
    "SchemaDriftValidator",
    "SchemaSnapshot",
    "SchemaSnapshotColumn",
    "SchemaValidationError",
    "build_schema_snapshot",
]
