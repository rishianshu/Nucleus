from __future__ import annotations

from typing import Optional

from runtime_core import MetadataQuery, MetadataRecord, MetadataTarget

from ..context import ContextBuilder
from ..transports import Transport


class SchemaService:
    def __init__(self, transport: Transport, context: ContextBuilder) -> None:
        self._transport = transport
        self._context = context

    def latest_snapshot(self, target: MetadataTarget) -> Optional[MetadataRecord]:
        return self._transport.latest(target, "catalog_snapshot")

    def history(
        self,
        target: MetadataTarget,
        *,
        limit: Optional[int] = None,
    ) -> list[MetadataRecord]:
        return list(self._transport.history(target, "catalog_snapshot", limit))

    def search(self, term: str, limit: int = 20) -> list[MetadataRecord]:
        criteria = MetadataQuery(filters={"search": term}, limit=limit)
        try:
            return list(self._transport.query(criteria))
        except NotImplementedError:  # pragma: no cover - depends on backend
            return []
