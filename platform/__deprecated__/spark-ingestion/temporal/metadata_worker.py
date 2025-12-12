#!/usr/bin/env python3
"""Temporal worker that runs metadata collection and preview activities."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Type, cast


ROOT = Path(__file__).resolve().parents[1]
PACKAGES_DIR = ROOT / "packages"
TEMPORAL_DIR = ROOT / "temporal"

PACKAGE_ROOTS = [
    PACKAGES_DIR / "runtime-common" / "src",
    PACKAGES_DIR / "core" / "src",
    PACKAGES_DIR / "metadata-service" / "src",
    TEMPORAL_DIR,
]


def _prepend_path(path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"Expected package path {path} does not exist")
    path_str = str(path)
    if path_str in sys.path:
        sys.path.remove(path_str)
    sys.path.insert(0, path_str)


for root in PACKAGE_ROOTS:
    _prepend_path(root)

# ensure modules are reloaded from repo
for module_name in ["endpoint_service", "ingestion_models", "metadata_service"]:
    if module_name in sys.modules:
        del sys.modules[module_name]

from temporalio import activity, client, worker
from temporalio.exceptions import ApplicationError
from metadata_service import __file__ as _metadata_service_file
from metadata_service.cache.manager import MetadataCacheConfig, MetadataCacheManager
from metadata_service.collector import MetadataCollectionService, MetadataServiceConfig
from metadata_service.planning import plan_metadata_jobs
from metadata_service.repository import CacheMetadataRepository
from metadata_service.ingestion.planner import plan_ingestion
from metadata_service.endpoints.registry import get_endpoint_class
from ingestion import run_ingestion_unit as _run_ingestion_unit
from staging import StagingHandle, stage_records

if ROOT not in Path(_metadata_service_file).resolve().parents:
    raise RuntimeError(
        f"metadata_service resolved to {_metadata_service_file}, expected under {ROOT}."
    )

from ingestion_models.requests import (
    CollectionJobRequest,
    CatalogRecordOutput,
    CollectionJobResult,
    PreviewRequest,
    IngestionUnitRequest,
    IngestionUnitResult,
)
from ingestion_models.endpoints import (
    ConfigurableEndpoint,
    EndpointUnitDescriptor,
    IngestionPlan,
    IngestionSlice,
    SupportsIncrementalPlanning,
    SupportsPreview,
)


class ActivityLogger:
    def __init__(self) -> None:
        self.entries: List[Dict[str, Any]] = []

    def _log(self, level: str, message: Optional[str], **fields: Any) -> None:
        entry = {"level": level}
        if message is not None:
            entry["message"] = message
        entry.update(fields)
        self.entries.append(entry)
        getattr(activity.logger, level.lower())(entry)

    def info(self, message: Optional[str] = None, **fields: Any) -> None:
        self._log("INFO", message, **fields)

    def warn(self, message: Optional[str] = None, **fields: Any) -> None:
        self._log("WARNING", message, **fields)

    def error(self, message: Optional[str] = None, **fields: Any) -> None:
        self._log("ERROR", message, **fields)


def _write_records_manifest(records: List[CatalogRecordOutput], run_id: str) -> Optional[str]:
    if not records:
        return None
    payload = [record.__dict__ for record in records]
    fd, path = tempfile.mkstemp(prefix=f"metadata-records-{run_id}-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, default=str)
    finally:
        try:
            os.close(fd)
        except OSError:
            # Best-effort close; ignore if already closed.
            pass
    return path


def _json_safe(value: Any) -> Any:
    """Recursively convert objects to JSON-serializable forms, guarding against cycles."""
    seen: set[int] = set()

    def _inner(val: Any) -> Any:
        oid = id(val)
        if oid in seen:
            return "<cycle>"
        seen.add(oid)
        if isinstance(val, datetime):
            return val.isoformat()
        if isinstance(val, dict):
            return {k: _inner(v) for k, v in val.items()}
        if isinstance(val, (list, tuple, set)):
            return [_inner(v) for v in val]
        if hasattr(val, "__dict__"):
            try:
                return _inner(vars(val))
            except Exception:
                ...
        if hasattr(val, "_asdict"):
            try:
                return _inner(val._asdict())
            except Exception:
                ...
        try:
            json.dumps(val)
            return val
        except Exception:
            try:
                return str(val)
            except Exception:
                return repr(val)

    return _inner(value)


def _resolve_target_slice_size(policy: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(policy, dict):
        return None
    for key in ("target_slice_size", "targetSliceSize", "target_rows_per_slice", "targetRowsPerSlice"):
        value = policy.get(key)
        if isinstance(value, (int, float)):
            try:
                return int(value)
            except Exception:
                continue
    return None


def _serialize_slices(slices: Optional[List[Any]]) -> List[Dict[str, Any]]:
    if not slices:
        return []
    serialized: List[Dict[str, Any]] = []
    for idx, slice_obj in enumerate(slices):
        if isinstance(slice_obj, IngestionSlice):
            payload = slice_obj.to_params()
        elif isinstance(slice_obj, dict):
            payload = dict(slice_obj)
        else:
            continue
        payload.setdefault("slice_key", payload.get("slice_key") or getattr(slice_obj, "key", None) or f"slice-{idx}")
        if "sequence" not in payload:
            seq_val = getattr(slice_obj, "sequence", None) if not isinstance(slice_obj, dict) else payload.get("sequence")
            seq_val = seq_val if seq_val is not None else idx
            try:
                payload["sequence"] = int(seq_val)
            except Exception:
                payload["sequence"] = idx
        serialized.append(payload)
    return serialized


def _finalize_collection_result(
    request: CollectionJobRequest,
    logger: ActivityLogger,
    records: List[CatalogRecordOutput],
) -> Dict[str, Any]:
    logger.info(event="metadata_collect_complete", datasets=len(records))
    records_path = _write_records_manifest(records, request.runId)
    return CollectionJobResult(
        recordsPath=records_path,
        recordCount=len(records),
        logs=logger.entries,
    ).__dict__


def _cleanup_plan_resources(plan) -> None:
    for callback in getattr(plan, "cleanup_callbacks", []) or []:
        try:
            callback()
        except Exception:  # pragma: no cover - defensive cleanup
            continue


def _collect_catalog_records(jobs, repository: CacheMetadataRepository, request: CollectionJobRequest) -> List[CatalogRecordOutput]:
    records: List[CatalogRecordOutput] = []
    for job in jobs:
        record = repository.latest(job.target)
        if not record:
            continue
        payload = record.payload if isinstance(record.payload, dict) else {}
        payload = dict(payload)
        payload["metadata_endpoint_id"] = request.endpointId
        metadata_block = dict(payload.get("_metadata") or {})
        metadata_block["source_endpoint_id"] = request.endpointId
        metadata_block["source_id"] = request.sourceId or request.endpointId
        payload["_metadata"] = metadata_block
        dataset_id = str(
            payload.get("id")
            or job.artifact.get("dataset")
            or job.artifact.get("table")
            or f"{job.target.namespace.lower()}_{job.target.entity.lower()}"
        )
        labels = sorted({*(request.labels or []), *(payload.get("labels") or [])})
        records.append(
            CatalogRecordOutput(
                id=dataset_id,
                projectId=request.projectId,
                domain="catalog.dataset",
                labels=labels,
                payload=payload,
            )
        )
    return records


def _decode_preview_payload(payload: str) -> Dict[str, Any]:
    try:
        data = json.loads(payload)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return data


def _preview_endpoint_dataset(request: PreviewRequest, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Legacy preview helper used by tests; constructs the endpoint from templateId/parameters
    and calls its metadata subsystem preview hook.
    """
    template_id = payload.get("templateId") or payload.get("template_id")
    if not template_id:
        raise ApplicationError("templateId is required for preview", type="PreviewTemplateMissing", non_retryable=True)
    endpoint_cls: Optional[Type[ConfigurableEndpoint]] = get_endpoint_class(template_id)
    parameters = payload.get("parameters") or {}
    table_cfg = {"schema": request.schema, "table": request.table}
    if endpoint_cls is None:
        raise ApplicationError(
            f"Unknown endpoint template '{template_id}'",
            type="PreviewTemplateMissing",
            non_retryable=True,
        )
    endpoint: ConfigurableEndpoint = endpoint_cls(None, parameters, table_cfg)
    if not isinstance(endpoint, SupportsPreview):
        raise ApplicationError(
            f"Endpoint '{template_id}' does not support preview",
            type="PreviewUnsupported",
            non_retryable=True,
        )
    rows = endpoint.preview(unit_id=request.datasetId, limit=request.limit or 50, filters=None)
    return {"rows": rows, "sampledAt": datetime.now(timezone.utc).isoformat()}


def _collect_catalog_snapshots_sync(request: CollectionJobRequest) -> Dict[str, Any]:
    logger = ActivityLogger()
    logger.info(event="metadata_collect_start", run_id=request.runId, endpoint=request.endpointName)
    temp_dir = tempfile.mkdtemp(prefix=f"metadata-collect-{request.runId}-")
    cache_cfg = MetadataCacheConfig(
        cache_path=temp_dir,
        ttl_hours=1,
        enabled=True,
        source_id=request.sourceId or request.endpointId or "metadata-endpoint",
    )
    cache_manager = MetadataCacheManager(cache_cfg, logger, spark=None)
    service_cfg = MetadataServiceConfig(endpoint_defaults={})
    metadata_service = MetadataCollectionService(service_cfg, cache_manager, logger, emitter=None)

    plan = plan_metadata_jobs(request, logger)
    if not plan.jobs:
        _cleanup_plan_resources(plan)
        shutil.rmtree(temp_dir, ignore_errors=True)
        return {"records": [], "logs": logger.entries}

    try:
        metadata_service.run(plan.jobs)
        repository = CacheMetadataRepository(cache_manager)
        records = _collect_catalog_records(plan.jobs, repository, request)
        return _finalize_collection_result(request, logger, records)
    finally:
        _cleanup_plan_resources(plan)
        shutil.rmtree(temp_dir, ignore_errors=True)


def _resolve_template_id_from_policy(policy: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(policy, dict):
        return None
    for key in ("templateId", "template_id", "template"):
        candidate = policy.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    parameters = policy.get("parameters")
    if isinstance(parameters, dict):
        for key in ("templateId", "template_id", "template"):
            candidate = parameters.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return None


def _plan_ingestion_unit_sync(request: IngestionUnitRequest) -> Dict[str, Any]:
    """
    Plan ingestion for a unit and return slice information for fan-out orchestration.
    """
    template_id = _resolve_template_id_from_policy(request.policy)
    if not template_id:
        raise ApplicationError(
            "templateId is required for ingestion planning",
            type="TemplateMissing",
            non_retryable=True,
        )
    endpoint_cfg = request.policy.get("parameters") if isinstance(request.policy, dict) else {}
    endpoint_cfg = endpoint_cfg if isinstance(endpoint_cfg, dict) else {}
    table_cfg = {"schema": "ingestion", "table": request.unitId, "endpoint_id": request.endpointId}
    tool = None
    try:
        from metadata_service.endpoints.registry import build_endpoint
        from endpoint_service.tools.sqlalchemy import SQLAlchemyTool

        url = endpoint_cfg.get("connection_url") or endpoint_cfg.get("url")
        if url:
            tool = SQLAlchemyTool.from_config({"runtime": {"sqlalchemy": {"url": url}}})
        endpoint = build_endpoint(template_id, tool=tool, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)
        unit_descriptor = None
        if hasattr(endpoint, "list_units"):
            try:
                descriptors = endpoint.list_units()
                unit_descriptor = next((d for d in descriptors if d.unit_id == request.unitId), None)
            except Exception:
                unit_descriptor = None
        last_wm = None
        if isinstance(request.checkpoint, dict):
            last_wm = request.checkpoint.get("watermark") or request.checkpoint.get("last_watermark")
        if isinstance(request.policy, dict) and not last_wm:
            last_wm = request.policy.get("last_watermark")

        slices: List[Dict[str, Any]] = []
        plan_metadata: Dict[str, Any] = {}
        strategy = None
        if isinstance(endpoint, SupportsIncrementalPlanning):
            try:
                plan_unit = unit_descriptor or EndpointUnitDescriptor(unit_id=request.unitId)
                plan_result = endpoint.plan_incremental_slices(
                    unit=plan_unit,
                    checkpoint=request.checkpoint if isinstance(request.checkpoint, dict) else None,
                    policy=request.policy if isinstance(request.policy, dict) else {},
                    target_slice_size=_resolve_target_slice_size(request.policy),
                )
                if isinstance(plan_result, IngestionPlan):
                    slices = _serialize_slices(plan_result.slices)
                    plan_metadata.update(plan_result.statistics or {})
                    strategy = plan_result.strategy or strategy
                elif plan_result is not None:
                    slices = _serialize_slices(plan_result)
            except Exception:
                slices = []

        if not slices:
            plan = plan_ingestion(
                cfg={
                    "endpoint": endpoint,
                    "runtime": (request.policy or {}).get("runtime", {}) if isinstance(request.policy, dict) else {},
                },
                table_cfg=table_cfg,
                mode=(request.mode or "full").lower(),
                load_date=str(request.policy.get("load_date")) if isinstance(request.policy, dict) and request.policy.get("load_date") is not None else datetime.now(timezone.utc).isoformat(),
                last_watermark=str(last_wm) if last_wm is not None else None,
                ingestion_strategy=getattr(unit_descriptor, "ingestion_strategy", None) if unit_descriptor else None,
                incremental_column=getattr(unit_descriptor, "incremental_column", None) if unit_descriptor else None,
                incremental_literal=getattr(unit_descriptor, "incremental_literal", None) if unit_descriptor else None,
            )
            slices = _serialize_slices(getattr(plan, "slices", []))
            plan_metadata.update(getattr(plan, "metadata", {}) or {})
        return {"slices": slices, "plan_metadata": plan_metadata, "strategy": strategy}
    finally:
        if tool and hasattr(tool, "stop"):
            try:
                tool.stop()
            except Exception:
                pass


def _run_ingestion_unit_sync(request: IngestionUnitRequest) -> Dict[str, Any]:
    logger = ActivityLogger()
    logger.info(
        event="ingestion_unit_start",
        endpoint_id=request.endpointId,
        unit_id=request.unitId,
        sink_id=request.sinkId,
        staging_provider=request.stagingProviderId or "in_memory",
    )
    logger.info(event="ingestion_policy_debug", policy=request.policy)
    normalized_mode = (request.mode or "").upper()
    reset_flag = False
    if isinstance(request.policy, dict):
        reset_flag = bool(request.policy.get("reset")) or bool(request.policy.get("resetCheckpoint"))
    checkpoint = None if normalized_mode == "FULL" or reset_flag else request.checkpoint
    template_id = _resolve_template_id_from_policy(request.policy)
    if not template_id:
        raise ApplicationError(
            "templateId is required for ingestion execution",
            type="TemplateMissing",
            non_retryable=True,
        )
    try:
        resp = _run_ingestion_unit(
            endpoint_id=request.endpointId,
            unit_id=request.unitId,
            template_id=template_id,
            policy=request.policy or {},
            checkpoint=checkpoint,
            mode=normalized_mode or None,
            data_mode=request.dataMode,
            filter=request.filter,
            transient_state=request.transientState,
            cdm_model_id=request.cdmModelId,
            logger=logger,
        )
    except ApplicationError:
        raise
    except Exception as exc:
        raise ApplicationError(str(exc), type="IngestionExecutionFailed", non_retryable=True) from exc

    records = resp.get("records")
    stats = resp.get("stats")
    new_checkpoint = resp.get("cursor") or resp.get("new_checkpoint") or checkpoint
    safe_stats = _json_safe(stats or {"note": "ingestion_noop", "unitId": request.unitId})
    safe_transient = _json_safe(getattr(resp, "transient_state", None) or resp.get("transient_state"))
    preview_mode = normalized_mode == "PREVIEW"

    if records is None:
        return IngestionUnitResult(newCheckpoint=new_checkpoint, stats=safe_stats, transientState=safe_transient).__dict__

    staging_handles: List[Dict[str, Any]] = []
    staged_handle = None
    if not preview_mode:
        staged_handle = stage_records(records, request.stagingProviderId)
        if staged_handle:
            staging_handles.append(staged_handle.__dict__)
        if staged_handle is None and records:
            raise ApplicationError(
                "Staging failed for ingestion records",
                type="StagingFailed",
                non_retryable=True,
            )
    logger.info(
        event="ingestion_complete",
        endpoint_id=request.endpointId,
        unit_id=request.unitId,
        template_id=template_id,
        stats=stats,
    )
    if preview_mode:
        safe_records = _json_safe(records)
        return IngestionUnitResult(
            newCheckpoint=new_checkpoint,
            stats=safe_stats,
            records=safe_records,
            transientState=safe_transient,
            staging=staging_handles,
            stagingPath=staged_handle.path if staged_handle else None,
            stagingProviderId=staged_handle.providerId if staged_handle else request.stagingProviderId,
        ).__dict__

    return IngestionUnitResult(
        newCheckpoint=new_checkpoint,
        stats=safe_stats,
        records=None,
        transientState=safe_transient,
        staging=staging_handles,
        stagingPath=staged_handle.path if staged_handle else None,
        stagingProviderId=staged_handle.providerId if staged_handle else request.stagingProviderId,
    ).__dict__


@activity.defn(name="collectCatalogSnapshots")
async def collect_catalog_snapshots(request: CollectionJobRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_collect_catalog_snapshots_sync, request)


def _is_seed_preview_request(request: PreviewRequest) -> bool:
    if request.datasetId and request.datasetId.startswith("sample_"):
        return True
    return _looks_like_sample_connection(request.connectionUrl)


def _looks_like_sample_connection(connection_url: Optional[str]) -> bool:
    if not connection_url:
        return False
    lowered = connection_url.lower()
    if "sample-host" in lowered or "metadata-seed" in lowered:
        return True
    return False


@activity.defn(name="previewDataset")
async def preview_dataset(request: PreviewRequest) -> Dict[str, Any]:
    # Reuse ingestion runner with preview semantics
    unit_id = request.unitId  # or request.datasetId
    # if request.schema and request.table:
    #     unit_id = f"{request.schema}.{request.table}"
    endpoint_id = request.endpointId or request.datasetId
    ingestion_request = IngestionUnitRequest(
        endpointId=endpoint_id,
        unitId=unit_id,
        policy={
            "templateId": request.templateId,
            "parameters": request.parameters,
            "limit": request.limit or 50,
            "mode": "PREVIEW",
            # Hint the runner with schema/table derived from the dataset metadata.
            "schema": request.schema,
            "table": request.table,
            "unitId": unit_id,
        },
        mode="PREVIEW",
        dataMode=None,
        sinkId=None,
        checkpoint=None,
        filter=None,
        transientState=None,
        transientStateVersion=None,
        stagingProviderId=None,
    )
    result = await asyncio.to_thread(_run_ingestion_unit_sync, ingestion_request)
    rows = result.get("records") or []
    records_path = result.get("stagingPath")
    staging_provider = result.get("stagingProviderId") or getattr(request, "stagingProviderId", None)

    # Avoid exceeding Temporal payload limits by staging large previews even in PREVIEW mode.
    if records_path is None and rows:
        max_bytes_env = os.getenv("METADATA_PREVIEW_MAX_BYTES")
        try:
            max_bytes = int(max_bytes_env) if max_bytes_env is not None else 500_000
        except ValueError:
            max_bytes = 500_000
        try:
            serialized = json.dumps(rows, default=str)
            if len(serialized.encode("utf-8")) > max_bytes:
                staged_handle = stage_records(rows, staging_provider)
                if staged_handle:
                    records_path = staged_handle.path
                    staging_provider = staged_handle.providerId
                    # Return a tiny summary so the preview response stays under payload limits.
                    rows = [{"_preview": "staged", "rowCount": len(rows), "recordsPath": records_path}]
        except Exception:
            # Best-effort staging; fall back to returning rows if sizing fails.
            pass

    return {
        "rows": rows,
        "sampledAt": datetime.now(timezone.utc).isoformat(),
        "recordsPath": records_path,
        "stagingProviderId": staging_provider,
    }


@activity.defn(name="runIngestionUnit")
async def run_ingestion_unit(request: IngestionUnitRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_run_ingestion_unit_sync, request)


@activity.defn(name="planIngestionUnit")
async def plan_ingestion_unit(request: IngestionUnitRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_plan_ingestion_unit_sync, request)


async def main() -> None:
    temporal_address = os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:7233")
    namespace = os.getenv("TEMPORAL_NAMESPACE", "default")
    task_queue = os.getenv("METADATA_PYTHON_TASK_QUEUE", "metadata-python")
    temporal_client = await client.Client.connect(temporal_address, namespace=namespace)
    worker_instance = worker.Worker(
        temporal_client,
        task_queue=task_queue,
        activities=[collect_catalog_snapshots, preview_dataset, plan_ingestion_unit, run_ingestion_unit],
    )
    await worker_instance.run()


if __name__ == "__main__":
    asyncio.run(main())
