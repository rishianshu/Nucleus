"""Exports for the shared metadata gateway package."""

from runtime_core import (
    MetadataContext,
    MetadataEmitter,
    MetadataQuery,
    MetadataRecord,
    MetadataRepository,
    MetadataTarget,
)

from .gateway import MetadataGateway

__all__ = [
    "MetadataContext",
    "MetadataEmitter",
    "MetadataQuery",
    "MetadataRecord",
    "MetadataRepository",
    "MetadataTarget",
    "MetadataGateway",
]
