from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from temporalio.exceptions import ApplicationError  # type: ignore

from endpoint_service.common import PrintLogger
from endpoint_service.events.bus import Emitter
from endpoint_service.events.helpers import emit_log
from endpoint_service.events.subscribers import FileQueueSubscriber, StructuredLogSubscriber
from endpoint_service.events.types import Event, EventCategory, EventType
from ingestion_models.endpoints import IngestionCapableEndpoint, SupportsIncrementalPlanning, SupportsIngestionUnits
from metadata_service.cdm_registry import apply_cdm
from metadata_service.endpoints.registry import build_endpoint
from metadata_service.ingestion.planner import plan_ingestion
from metadata_service.ingestion.runtime import (
    _maybe_emit_ingestion_metrics,
    _maybe_emit_ingestion_runtime,
)


@dataclass
class IngestionContext:
    emitter: Emitter
    logger: Any
    metadata_feature_flags: Dict[str, Any]

    def emit_event(self, category: EventCategory, type: EventType, **payload: Any) -> None:
        event = Event(category=category, type=type, payload=payload)
        self.emitter.emit(event)


def run_ingestion_unit(
    *,
    endpoint_id: str,
    unit_id: str,
    template_id: str,
    policy: Optional[Dict[str, Any]],
    checkpoint: Optional[Dict[str, Any]],
    mode: Optional[str],
    data_mode: Optional[str],
    filter: Optional[Dict[str, Any]],
    transient_state: Optional[Dict[str, Any]],
    cdm_model_id: Optional[str],
    logger: Any,
) -> Dict[str, Any]:
    completed_at = datetime.now(timezone.utc).isoformat()
    ingestion_logger = logger or PrintLogger(job_name=f"ingestion:{endpoint_id}")
    if not hasattr(ingestion_logger, "event"):
        # Minimal adapter so StructuredLogSubscriber can work with ActivityLogger-like objects.
        class _LoggerAdapter:
            def __init__(self, delegate):
                self._delegate = delegate

            def event(self, message: Optional[str] = None, *, level: str = "INFO", **fields: Any) -> None:
                # Avoid msg duplication when downstream passes msg in fields
                if "msg" in fields:
                    msg_field = fields.pop("msg")
                    if message is None:
                        message = msg_field
                fn = getattr(self._delegate, level.lower(), None) or getattr(self._delegate, "info", None)
                if callable(fn):
                    fn(message, **fields)

            def info(self, msg: str, **fields: Any) -> None:
                fn = getattr(self._delegate, "info", None)
                if callable(fn):
                    fn(msg, **fields)

            def warn(self, msg: str, **fields: Any) -> None:
                fn = getattr(self._delegate, "warn", None) or getattr(self._delegate, "warning", None)
                if callable(fn):
                    fn(msg, **fields)

            def error(self, msg: str, **fields: Any) -> None:
                fn = getattr(self._delegate, "error", None)
                if callable(fn):
                    fn(msg, **fields)

        ingestion_logger = _LoggerAdapter(ingestion_logger)
    emitter = Emitter()
    job_name = f"ingestion:{endpoint_id}"
    emitter.subscribe(StructuredLogSubscriber(ingestion_logger, job_name=job_name))
    event_path = None
    if isinstance(policy, dict):
        event_path = policy.get("event_outbox_path") or policy.get("event_log_path")
    if event_path:
        emitter.subscribe(FileQueueSubscriber(str(event_path), job_name=job_name))
    context = IngestionContext(
        emitter=emitter,
        logger=ingestion_logger,
        metadata_feature_flags=(policy or {}).get("metadata_flags", {}) if isinstance(policy, dict) else {},
    )
    endpoint_cfg = _resolve_parameters_from_policy(policy)

    if not unit_id:
        raise ApplicationError("unitId is required for ingestion", type="UnitIdMissing", non_retryable=True)
    # Derive schema/table directly from the provided unit_id; no hinting or guessing.
    schema_part, table_part = ("public", unit_id)
    if "." in unit_id:
        schema_part, table_part = unit_id.split(".", 1)
    table_cfg = {
        "schema": str(schema_part).strip().strip('"').lower(),
        "table": str(table_part),
        "endpoint_id": endpoint_id,
    }
    tool = None
    try:
        endpoint = build_endpoint(template_id, tool=tool, endpoint_cfg=endpoint_cfg or {}, table_cfg=table_cfg)
    except Exception as exc:
        _safe_stop_tool(tool)
        raise ApplicationError(
            f"Unable to initialize endpoint for template {template_id}: {exc}",
            type="IngestionEndpointInitFailed",
            non_retryable=True,
        )

    if isinstance(endpoint, SupportsIngestionUnits):
        units = endpoint.list_units()
        valid_units = {u.unit_id for u in units}
        if unit_id not in valid_units:
            _safe_stop_tool(tool)
            emit_log(emitter, level="WARN", msg="unit_not_found", logger=ingestion_logger, unitId=unit_id)
            stats = {"note": "unit_not_found", "unitId": unit_id, "completedAt": completed_at}
            return {"result": None, "stats": stats}

    if not isinstance(endpoint, IngestionCapableEndpoint):
        _safe_stop_tool(tool)
        raise ApplicationError(
            f"Endpoint template {template_id} does not support ingestion execution",
            type="IngestionNotSupported",
            non_retryable=True,
        )

    planned_slices = None
    if isinstance(endpoint, SupportsIncrementalPlanning):
        try:
            planned_slices = endpoint.plan_incremental_slices(unit_id=unit_id, checkpoint=checkpoint, limit=None)
            emitter.emit(
                Event(
                    category=EventCategory.PLAN,
                    type=EventType.PLAN_ADAPT,
                    payload={"unitId": unit_id, "slices": len(planned_slices or [])},
                )
            )
        except Exception as exc:
            emit_log(
                emitter,
                level="WARN",
                msg="plan_incremental_slices_failed",
                logger=ingestion_logger,
                unitId=unit_id,
                error=str(exc),
            )

    # Optional planner-driven slicing (independent of endpoint hook)
    plan = None
    unit_descriptor = None
    if isinstance(endpoint, SupportsIngestionUnits):
        try:
            descriptors = endpoint.list_units()
            unit_descriptor = next((d for d in descriptors if d.unit_id == unit_id), None)
        except Exception:
            unit_descriptor = None

    try:
        ingestion_cfg = dict(policy or {}) if isinstance(policy, dict) else {}
        ingestion_cfg["endpoint"] = endpoint
        load_date = None
        if isinstance(policy, dict):
            load_date = policy.get("load_date")
        load_date = load_date or completed_at
        last_wm = None
        if isinstance(checkpoint, dict):
            last_wm = checkpoint.get("watermark") or checkpoint.get("last_watermark")
        if isinstance(policy, dict) and not last_wm:
            last_wm = policy.get("last_watermark")
        strategy = None
        incr_col_hint = None
        incr_lit_hint = None
        if unit_descriptor:
            strategy = unit_descriptor.ingestion_strategy or strategy
            incr_col_hint = unit_descriptor.incremental_column or incr_col_hint
            incr_lit_hint = unit_descriptor.incremental_literal or incr_lit_hint
        if isinstance(policy, dict):
            strategy = policy.get("ingestion_strategy") or strategy
            incr_col_hint = policy.get("incremental_column") or incr_col_hint
            incr_lit_hint = policy.get("incremental_literal") or incr_lit_hint
        plan = plan_ingestion(
            cfg=ingestion_cfg,
            table_cfg=table_cfg,
            mode=mode or "full",
            load_date=str(load_date),
            last_watermark=str(last_wm) if last_wm is not None else None,
            ingestion_strategy=strategy,
            incremental_column=incr_col_hint,
            incremental_literal=incr_lit_hint,
        )
        if plan and getattr(plan, "slices", None):
            planned_slices = plan.slices
            emitter.emit(
                Event(
                    category=EventCategory.PLAN,
                    type=EventType.PLAN_ADAPT,
                    payload={
                        "unitId": unit_id,
                        "endpointId": endpoint_id,
                        "slices": len(plan.slices),
                        "plan_metadata": getattr(plan, "metadata", {}),
                    },
                )
            )
    except Exception as exc:
        emit_log(
            emitter,
            level="WARN",
            msg="planner_failed",
            logger=ingestion_logger,
            unitId=unit_id,
            error=str(exc),
        )

    emitter.emit(
        Event(
            category=EventCategory.INGEST,
            type=EventType.INGEST_TABLE_START,
            payload={"unitId": unit_id, "endpointId": endpoint_id, "mode": mode},
        )
    )

    try:
        effective_policy = dict(policy or {})
        if planned_slices:
            effective_policy.setdefault("planned_slices", planned_slices)

        if planned_slices:
            all_records = []
            slice_stats = []
            last_result = None
            for idx, slice_bounds in enumerate(planned_slices):
                slice_policy = dict(effective_policy)
                slice_policy["slice"] = slice_bounds
                slice_policy["slice_index"] = idx
                result = endpoint.run_ingestion_unit(
                    unit_id,
                    endpoint_id=endpoint_id,
                    policy=slice_policy,
                    checkpoint=checkpoint,
                    mode=mode,
                    filter=filter,
                    transient_state=transient_state,
                )
                last_result = result
                slice_records = getattr(result, "records", None) or []
                all_records.extend(slice_records)
                st = getattr(result, "stats", {}) or {}
                st.setdefault("slice", slice_bounds)
                st.setdefault("sliceIndex", idx)
                slice_stats.append(st)
            if last_result is None:
                raise RuntimeError("planned_slices provided but no results returned")
            records = all_records
            stats = getattr(last_result, "stats", {}) or {}
            stats.setdefault("plannedSlices", len(planned_slices))
            stats["slices"] = slice_stats
            payload = getattr(last_result, "__dict__", last_result)
        else:
            result = endpoint.run_ingestion_unit(
                unit_id,
                endpoint_id=endpoint_id,
                policy=effective_policy,
                checkpoint=checkpoint,
                mode=mode,
                filter=filter,
                transient_state=transient_state,
            )
            records = getattr(result, "records", None) or []
            stats = getattr(result, "stats", {}) or {}
            payload = getattr(result, "__dict__", result)

        if cdm_model_id:
            family = template_id.split(".", 1)[0]
            records = apply_cdm(family, unit_id, cdm_model_id, records, dataset_id=unit_id, endpoint_id=endpoint_id)
        stats.setdefault("completedAt", completed_at)
        stats.setdefault("unitId", unit_id)
        stats.setdefault("endpointId", endpoint_id)
        payload = dict(payload)
        payload["records"] = records
        payload["stats"] = stats
        emitter.emit(
            Event(
                category=EventCategory.INGEST,
                type=EventType.INGEST_TABLE_SUCCESS,
                payload={"unitId": unit_id, "endpointId": endpoint_id, "rows": stats.get("rows")},
            )
        )
        # Emit lightweight metrics
        _maybe_emit_ingestion_runtime(
            context,
            schema=table_cfg.get("schema") or "ingestion",
            table=unit_id,
            mode=mode or "full",
            load_date=policy.get("load_date") if isinstance(policy, dict) else None or completed_at,
            duration=stats.get("durationSeconds") if isinstance(stats, dict) else None,
            status="success",
            rows=stats.get("rows") if isinstance(stats, dict) else None,
        )
        _maybe_emit_ingestion_metrics(
            context,
            schema=table_cfg.get("schema") or "ingestion",
            table=unit_id,
            mode=mode or "full",
            load_date=policy.get("load_date") if isinstance(policy, dict) else None or completed_at,
            rows=stats.get("rows") if isinstance(stats, dict) else None,
            result=stats,
        )
        return payload
    except Exception as exc:
        emitter.emit(
            Event(
                category=EventCategory.INGEST,
                type=EventType.INGEST_TABLE_FAILURE,
                payload={
                    "unitId": unit_id,
                    "endpointId": endpoint_id,
                    "error": str(exc),
                    "mode": mode,
                },
            )
        )
        _maybe_emit_ingestion_runtime(
            context,
            schema=table_cfg.get("schema") or "ingestion",
            table=unit_id,
            mode=mode or "full",
            load_date=policy.get("load_date") if isinstance(policy, dict) else None or completed_at,
            duration=None,
            status="failed",
            error=str(exc),
        )
        raise
    finally:
        _safe_stop_tool(tool)


def _resolve_parameters_from_policy(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    params = policy.get("parameters") if isinstance(policy, dict) else None
    cfg = params if isinstance(params, dict) else {}
    if not isinstance(cfg, dict):
        return {}
    # Normalize common JDBC keys so endpoints see what they expect.
    normalized = dict(cfg)
    if "connectionUrl" in cfg and "url" not in normalized:
        normalized["url"] = cfg["connectionUrl"]
    if "connection_url" in cfg and "url" not in normalized:
        normalized["url"] = cfg["connection_url"]
    if "username" in cfg and "user" not in normalized:
        normalized["user"] = cfg["username"]
    return normalized


def _safe_stop_tool(tool) -> None:
    if tool is None:
        return
    stop = getattr(tool, "stop", None)
    if callable(stop):
        try:
            stop()
        except Exception:
            pass
