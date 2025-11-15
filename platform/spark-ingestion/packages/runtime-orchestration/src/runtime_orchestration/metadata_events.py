from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from runtime_common.common import RUN_ID, PrintLogger
from runtime_common.events.types import Event, EventCategory, EventType, Subscriber
from metadata_sdk.types import MetadataContext, MetadataRecord, MetadataTarget

try:  # pragma: no cover - optional dependency wiring
    from metadata_sdk import DataVolumeMetric, RuntimeMetric
except ModuleNotFoundError:  # pragma: no cover - allow running without SDK installed
    DataVolumeMetric = RuntimeMetric = None  # type: ignore


class MetadataEventSubscriber(Subscriber):
    """Relays metadata events from the emitter to the configured backend."""

    def __init__(
        self,
        logger: PrintLogger,
        *,
        metadata_access: Optional[Any] = None,
        metadata_sdk: Optional[Any] = None,
        metadata_gateway: Optional[Any] = None,
    ) -> None:
        self.logger = logger
        self.metadata_access = metadata_access
        self.metadata_sdk = metadata_sdk or getattr(metadata_access, "sdk", None)
        self.metadata_gateway = metadata_gateway or getattr(metadata_access, "gateway", None)

    def interests(self) -> Iterable[EventCategory]:
        return (EventCategory.METADATA,)

    def on_event(self, event: Event) -> None:
        if event.type == EventType.METADATA_RECORD:
            record = event.payload.get("record")
            if record is None:
                return
            self._emit_record(record)
        elif event.type == EventType.METADATA_METRIC:
            self._emit_metric(event.payload)

    # ------------------------------------------------------------------

    def _emit_metric(self, payload: Dict[str, Any]) -> None:
        if not payload:
            return
        target: Optional[MetadataTarget] = payload.get("target")
        if target is None:
            return
        produced_at: datetime = payload.get("produced_at") or datetime.now(timezone.utc)
        metric_kind = payload.get("metric_kind") or payload.get("record_kind")
        record_payload: Dict[str, Any] = payload.get("record_payload") or {}
        producer_id = payload.get("producer_id") or "runtime.metadata"
        metric_payload: Dict[str, Any] = payload.get("metric_payload") or {}
        extras = metric_payload.get("extras") or {}
        sdk = self.metadata_sdk
        if sdk:
            try:
                if metric_kind == "ingestion_volume" and DataVolumeMetric is not None:
                    metric = DataVolumeMetric(
                        target=target,
                        payload=record_payload,
                        rows=metric_payload.get("rows"),
                        mode=metric_payload.get("mode"),
                        load_date=metric_payload.get("load_date"),
                        produced_at=produced_at,
                        extras=extras,
                    )
                    sdk.ingestion.emit_volume(metric)
                    return
                if metric_kind == "ingestion_runtime" and RuntimeMetric is not None:
                    metric = RuntimeMetric(
                        target=target,
                        payload=record_payload,
                        status=metric_payload.get("status"),
                        duration_seconds=metric_payload.get("duration_seconds"),
                        error=metric_payload.get("error"),
                        produced_at=produced_at,
                        extras=extras,
                    )
                    sdk.ingestion.emit_runtime(metric)
                    return
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.warn(
                    "metadata_sdk_metric_emit_failed",
                    kind=metric_kind,
                    error=str(exc),
                )
        record_kind = payload.get("record_kind") or metric_kind or "metadata.metric"
        record = MetadataRecord(
            target=target,
            kind=record_kind,
            payload=record_payload,
            produced_at=produced_at,
            producer_id=producer_id,
        )
        self._emit_record(record)

    def _emit_record(self, record: MetadataRecord) -> None:
        sdk = self.metadata_sdk
        if sdk:
            try:
                ctx = sdk.context.for_target(record.target)
                sdk.transport.emit(ctx, record)
                return
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.warn(
                    "metadata_sdk_emit_failed",
                    kind=record.kind,
                    error=str(exc),
                )
        gateway = self.metadata_gateway
        if gateway is None:
            self.logger.debug(
                "metadata_emit_dropped",
                kind=record.kind,
            )
            return
        context = MetadataContext(
            source_id=record.target.source_id,
            job_id=None,
            run_id=RUN_ID,
            namespace=record.target.namespace,
        )
        try:
            gateway.emit(context, record)
        except Exception as exc:  # pragma: no cover - defensive logging
            self.logger.warn(
                "metadata_gateway_emit_failed",
                kind=record.kind,
                error=str(exc),
            )


__all__ = ["MetadataEventSubscriber"]
