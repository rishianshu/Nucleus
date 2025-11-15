from __future__ import annotations

import hashlib
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple, Optional

from metadata_sdk.types import MetadataRecord, MetadataTarget

from metadata_service.utils import safe_upper, to_serializable
from runtime_common.common import PrintLogger, RUN_ID
from runtime_common.events import Event, EventCategory, EventType, emit_log
from ingestion_runtime.planning import AdaptivePlanner, PlannerRequest
from ingestion_runtime.planning.base import REGISTRY as PLANNER_REGISTRY
from ingestion_runtime.strategies import STRATEGY_REGISTRY


def _ingest_one_table(
    context,
    cfg: Dict[str, Any],
    state,
    logger: PrintLogger,
    tbl: Dict[str, Any],
    pool_name: str,
    load_date: str,
) -> Dict[str, Any]:
    _ = AdaptivePlanner  # noqa: F841  (import side-effects)
    from runtime_common.endpoints.factory import EndpointFactory  # local import to avoid circular dependency

    schema, table = tbl["schema"], tbl["table"]
    mode = tbl.get("mode", "full").lower()
    tool = context.tool
    if tool is None:
        raise RuntimeError("Execution tool is required for ingestion")
    tool.set_job_context(
        pool=pool_name,
        group_id=f"ingest::{schema}.{table}",
        description=f"Ingest {schema}.{table}",
    )
    emit_log(
        context.emitter,
        level="INFO",
        msg="table_start",
        schema=schema,
        table=table,
        mode=mode,
        pool=pool_name,
        load_date=load_date,
        logger=logger,
    )
    context.emit_event(
        EventCategory.INGEST,
        EventType.INGEST_TABLE_START,
        schema=schema,
        table=table,
        mode=mode,
        load_date=load_date,
        pool=pool_name,
    )
    if context.emitter is not None:
        context.emitter.emit(
            Event(
                category=EventCategory.TOOL,
                type=EventType.TOOL_PROGRESS,
                payload={
                    "schema": schema,
                    "table": table,
                    "mode": mode,
                    "pool": pool_name,
                    "status": "started",
                },
            )
        )
    source_ep, sink_ep = EndpointFactory.build_endpoints(
        tool,
        cfg,
        tbl,
        metadata=context.metadata_access,
        emitter=context.emitter,
    )
    try:
        planner = PLANNER_REGISTRY.get("default")
    except KeyError:
        planner = AdaptivePlanner()
        PLANNER_REGISTRY.register("default", planner)
    planner_request = PlannerRequest(
        schema=schema,
        table=table,
        load_date=load_date,
        mode=mode,
        table_cfg={
            "slicing": cfg["runtime"].get("scd1_slicing", {}),
            "runtime": cfg["runtime"],
            "table": tbl,
        },
    )
    strategy = STRATEGY_REGISTRY.get(mode)
    if strategy is None:
        raise ValueError(f"Unsupported mode: {mode}")
    try:
        start_ts = time.time()
        result = strategy.run(
            context,
            cfg,
            state,
            logger,
            source_ep,
            sink_ep,
            planner,
            planner_request,
        )
        duration = time.time() - start_ts
        rows = None
        if isinstance(result, dict):
            rows = result.get("rows") or result.get("rows_written")
        context.emit_event(
            EventCategory.INGEST,
            EventType.INGEST_TABLE_SUCCESS,
            schema=schema,
            table=table,
            mode=mode,
            load_date=load_date,
            rows=rows,
            duration_sec=duration,
        )
        if context.emitter is not None:
            context.emitter.emit(
                Event(
                    category=EventCategory.TOOL,
                    type=EventType.TOOL_PROGRESS,
                    payload={
                        "schema": schema,
                        "table": table,
                        "mode": mode,
                        "pool": pool_name,
                        "status": "success",
                        "result": result,
                    },
                )
            )
        rows_value = rows
        if rows_value is None and isinstance(result, dict):
            rows_value = result.get("rows") or result.get("rows_written")
        _maybe_emit_ingestion_metrics(context, schema, table, mode, load_date, rows_value, result)
        _maybe_emit_ingestion_runtime(context, schema, table, mode, load_date, duration, "success", rows_value)
        return result
    except Exception as exc:
        stack = traceback.format_exc()
        stack_hash = hashlib.sha1(stack.encode("utf-8")).hexdigest()[:10]
        context.emit_event(
            EventCategory.INGEST,
            EventType.INGEST_TABLE_FAILURE,
            schema=schema,
            table=table,
            mode=mode,
            load_date=load_date,
            error_type=type(exc).__name__,
            message=str(exc),
            error_hash=stack_hash,
        )
        duration = time.time() - start_ts
        _maybe_emit_ingestion_runtime(context, schema, table, mode, load_date, duration, "failure", error=str(exc))
        raise
    finally:
        tool.clear_job_context()


def run_ingestion(
    context,
    cfg: Dict[str, Any],
    state,
    logger: PrintLogger,
    tables: List[Dict[str, Any]],
    load_date: str,
    heartbeat,
    notifier,
) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str]]]:
    max_workers = int(cfg["runtime"].get("max_parallel_tables", 4))
    results: List[Dict[str, Any]] = []
    errors: List[Tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futmap = {}
        for idx, tbl in enumerate(tables):
            pool = f"pool-{(idx % max_workers) + 1}"
            fut = executor.submit(_ingest_one_table, context, cfg, state, logger, tbl, pool, load_date)
            futmap[fut] = f"{tbl['schema']}.{tbl['table']}"
            heartbeat.update(inflight=len(futmap))
        for fut in as_completed(futmap):
            key = futmap[fut]
            try:
                res = fut.result()
                results.append(res)
                emit_log(context.emitter, level="INFO", msg="table_done", table=key, result="ok", logger=logger)
                heartbeat.update(done=len(results), inflight=len(futmap) - len(results) - len(errors))
            except Exception as exc:  # pragma: no cover - defensive logging
                stacktrace = traceback.format_exc()
                errors.append((key, str(exc)))
                heartbeat.update(failed=len(errors), inflight=len(futmap) - len(results) - len(errors))
                emit_log(
                    context.emitter,
                    level="ERROR",
                    msg="table_failed",
                    table=key,
                    error=str(exc),
                    error_type=type(exc).__name__,
                    stacktrace=stacktrace,
                    logger=logger,
                )
                if context.emitter is not None:
                    context.emitter.emit(
                        Event(
                            category=EventCategory.TOOL,
                            type=EventType.TOOL_PROGRESS,
                            payload={
                                "table": key,
                                "status": "failed",
                                "error": str(exc),
                            },
                        )
                    )
    return results, errors


def _metadata_feature_enabled(context, flag: str) -> bool:
    return bool(
        getattr(context, "metadata_feature_flags", {}).get(flag)
        and (
            getattr(context, "metadata_sdk", None)
            or (getattr(context, "metadata_gateway", None) and getattr(context, "metadata_access", None))
        )
    )


def _metadata_target(context, schema: str, table: str) -> MetadataTarget:
    source_id = (
        context.metadata_access.cache_manager.cfg.source_id  # type: ignore[attr-defined]
        if getattr(context, "metadata_access", None)
        else "ingestion"
    )
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
