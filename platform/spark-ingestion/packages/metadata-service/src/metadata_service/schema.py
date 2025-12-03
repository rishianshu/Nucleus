"""Backward-compatible shim exposing schema helpers via ingestion_models."""

from ingestion_models.schema import (
    SchemaDriftPolicy,
    SchemaDriftResult,
    SchemaDriftValidator,
    SchemaSnapshot,
    SchemaSnapshotColumn,
    SchemaValidationError,
    build_schema_snapshot,
)

__all__ = [
    "SchemaDriftPolicy",
    "SchemaDriftResult",
    "SchemaDriftValidator",
    "SchemaSnapshot",
    "SchemaSnapshotColumn",
    "SchemaValidationError",
    "build_schema_snapshot",
]
