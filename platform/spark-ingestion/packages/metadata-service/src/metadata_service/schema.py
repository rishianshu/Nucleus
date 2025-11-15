"""Backward-compatible shim exposing schema helpers from metadata_sdk."""

from metadata_sdk.schema import (
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
