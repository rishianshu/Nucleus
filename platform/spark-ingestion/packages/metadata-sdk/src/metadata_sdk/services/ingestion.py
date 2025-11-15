from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

from runtime_core import MetadataQuery, MetadataRecord, MetadataTarget

from ..context import ContextBuilder
from ..models import DataVolumeMetric, RuntimeMetric
from ..transports import Transport


class IngestionService:
    def __init__(self, transport: Transport, context: ContextBuilder) -> None:
        self._transport = transport
        self._context = context

    def emit_volume(self, metric: DataVolumeMetric) -> None:
        record = metric.to_metadata_record()
        ctx = self._context.for_target(record.target)
        self._transport.emit(ctx, record)

    def emit_runtime(self, metric: RuntimeMetric) -> None:
        record = metric.to_metadata_record()
        ctx = self._context.for_target(record.target)
        self._transport.emit(ctx, record)

    def emit_batch(self, records: Iterable[MetadataRecord]) -> None:
        records = list(records)
        if not records:
            return
        ctx = self._context.for_target(records[0].target)
        self._transport.emit_many(ctx, records)

    def history(
        self,
        target: MetadataTarget,
        *,
        kind: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[MetadataRecord]:
        return list(self._transport.history(target, kind or "ingestion_volume", limit))

    def runtime_history(
        self,
        target: MetadataTarget,
        *,
        limit: Optional[int] = None,
    ) -> list[MetadataRecord]:
        return list(self._transport.history(target, "ingestion_runtime", limit))

    def trends(
        self,
        target: MetadataTarget,
        *,
        window: int = 7,
    ) -> list[dict]:
        records = self.history(target, limit=window * 2)
        data = []
        for record in records:
            payload = dict(record.payload)
            produced = payload.get("produced_at") or record.produced_at.isoformat()
            rows = payload.get("rows")
            if rows is None:
                continue
            data.append({"produced_at": produced, "rows": rows})
        return data
