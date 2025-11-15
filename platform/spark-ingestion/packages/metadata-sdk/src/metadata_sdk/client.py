from __future__ import annotations

from typing import Optional

from runtime_core import MetadataTarget

from .context import ContextBuilder, ContextOptions
from .services.catalog import CatalogService
from .services.ingestion import IngestionService
from .services.schemas import SchemaService
from .transports import EmbeddedTransport, Transport


class MetadataSDK:
    """High-level entry point for interacting with the metadata platform."""

    def __init__(
        self,
        *,
        transport: Transport,
        context: ContextBuilder,
    ) -> None:
        self.transport = transport
        self.context = context
        self.ingestion = IngestionService(transport, context)
        self.schemas = SchemaService(transport, context)
        self.catalog = CatalogService(transport)

    @classmethod
    def with_embedded(
        cls,
        repository,
        *,
        gateway=None,
        source_id: str,
        namespace: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> "MetadataSDK":
        transport = EmbeddedTransport(repository, gateway=gateway)
        context = ContextBuilder(ContextOptions(source_id=source_id, namespace=namespace, run_id=run_id))
        return cls(transport=transport, context=context)

    def describe(self, target: MetadataTarget):
        return self.catalog.describe(target)


# Backwards compatibility alias
MetadataClient = MetadataSDK
