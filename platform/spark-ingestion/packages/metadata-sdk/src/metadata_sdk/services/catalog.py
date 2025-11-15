from __future__ import annotations

from typing import Dict, List, Optional

from runtime_core import MetadataQuery, MetadataRecord, MetadataTarget

from ..transports import Transport


class CatalogService:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def describe(self, target: MetadataTarget) -> Dict[str, any]:
        snapshot = self._transport.latest(target, "catalog_snapshot")
        history = self._transport.history(target, "catalog_snapshot", limit=5)
        return {
            "target": {
                "source_id": target.source_id,
                "namespace": target.namespace,
                "entity": target.entity,
            },
            "snapshot": snapshot.payload if snapshot else None,
            "history": [rec.payload for rec in history],
        }

    def search(self, term: str, *, limit: int = 20) -> List[MetadataRecord]:
        criteria = MetadataQuery(filters={"search": term}, limit=limit)
        try:
            return list(self._transport.query(criteria))
        except NotImplementedError:  # pragma: no cover
            return []
