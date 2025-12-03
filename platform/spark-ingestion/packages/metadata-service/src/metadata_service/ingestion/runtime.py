from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from endpoint_service.common import RUN_ID, safe_upper, to_serializable
from endpoint_service.events.types import EventCategory, EventType, Event
from ingestion_models.metadata import MetadataRecord, MetadataTarget


def _metadata_feature_enabled(context, flag: str) -> bool:
    flags = getattr(context, "metadata_feature_flags", {}) or {}
    return bool(flags.get(flag, False))


def _metadata_target(context, schema: str, table: str) -> MetadataTarget:
    source_id = getattr(getattr(getattr(context, "metadata_access", None), "cache_manager", None), "cfg", None)
    if source_id and hasattr(source_id, "source_id"):
        source_id = source_id.source_id
    else:
        source_id = "ingestion"
    return MetadataTarget(
        source_id=str(source_id),
        namespace=safe_upper(schema),
        entity=safe_upper(table),
    )


def _maybe_emit_ingestion_metrics(
    context,
    schema: str,
    table: str,
    mode: str,
    load_date: str,
    rows: Optional[int],
    result: Any,
) -> None:
    if not _metadata_feature_enabled(context, "ingestion_metrics"):
        return
    target = _metadata_target(context, schema, table)
    produced_at = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "schema": schema,
        "table": table,
        "mode": mode,
        "load_date": load_date,
        "rows": rows,
        "run_id": RUN_ID,
    }
    if isinstance(result, dict) and result:
        payload["result"] = to_serializable(result)
    payload = {k: v for k, v in payload.items() if v is not None}
    record = MetadataRecord(
        target=target,
        kind="ingestion_volume",
        payload=payload,
        produced_at=produced_at,
        producer_id="ingestion.runtime",
    )
    metric_payload = {
        "rows": rows,
        "mode": mode,
        "load_date": load_date,
        "extras": {"result": to_serializable(result)} if result else {},
    }
    context.emit_event(
        EventCategory.METADATA,
        EventType.METADATA_METRIC,
        metric_kind="ingestion_volume",
        target=target,
        produced_at=produced_at,
        record=record,
        metric_payload=metric_payload,
    )


def _maybe_emit_ingestion_runtime(
    context,
    schema: str,
    table: str,
    mode: str,
    load_date: str,
    duration: Optional[float],
    status: str,
    rows: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    if not _metadata_feature_enabled(context, "ingestion_runtime"):
        return
    target = _metadata_target(context, schema, table)
    produced_at = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "schema": schema,
        "table": table,
        "mode": mode,
        "load_date": load_date,
        "status": status,
        "run_id": RUN_ID,
    }
    if duration is not None:
        payload["duration_seconds"] = round(duration, 3)
    if rows is not None:
        payload["rows"] = rows
    if error:
        payload["error"] = str(error)[:512]
    record = MetadataRecord(
        target=target,
        kind="ingestion_runtime",
        payload=payload,
        produced_at=produced_at,
        producer_id="ingestion.runtime",
    )
    metric_payload = {
        "status": status,
        "duration_seconds": duration,
        "error": error,
        "extras": {"rows": rows} if rows is not None else {},
    }
    context.emit_event(
        EventCategory.METADATA,
        EventType.METADATA_METRIC,
        metric_kind="ingestion_runtime",
        target=target,
        produced_at=produced_at,
        record=record,
        metric_payload=metric_payload,
    )


def _maybe_emit_metadata(
    context,
    *,
    schema: str,
    table: str,
    mode: str,
    load_date: str,
    duration: Optional[float],
    status: str,
    error: Optional[str] = None,
) -> None:
    if not _metadata_feature_enabled(context, "metadata"):
        return
    target = _metadata_target(context, schema, table)
    produced_at = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "schema": schema,
        "table": table,
        "mode": mode,
        "load_date": load_date,
        "status": status,
        "run_id": RUN_ID,
    }
    if duration is not None:
        payload["duration_seconds"] = round(duration, 3)
    if error:
        payload["error"] = str(error)[:512]
    record = MetadataRecord(
        target=target,
        kind="metadata",
        payload=payload,
        produced_at=produced_at,
        producer_id="ingestion.runtime",
    )
    metric_payload = {
        "status": status,
        "duration_seconds": duration,
        "error": error,
    }
    context.emit_event(
        EventCategory.METADATA,
        EventType.METADATA_METRIC,
        metric_kind="metadata",
        target=target,
        produced_at=produced_at,
        record=record,
        metric_payload=metric_payload,
    )


__all__ = [
    "_maybe_emit_ingestion_metrics",
    "_maybe_emit_ingestion_runtime",
    "_maybe_emit_metadata",
]
