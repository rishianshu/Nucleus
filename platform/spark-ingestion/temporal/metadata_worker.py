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
from typing import Any, Dict, List, Optional


ROOT = Path(__file__).resolve().parents[1]
PACKAGES_DIR = ROOT / "packages"
TEMPORAL_DIR = ROOT / "temporal"

PACKAGE_ROOTS = [
    PACKAGES_DIR / "runtime-common" / "src",
    PACKAGES_DIR / "core" / "src",
    PACKAGES_DIR / "metadata-service" / "src",
    PACKAGES_DIR / "metadata-gateway" / "src",
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
for module_name in ["runtime_common", "runtime_core", "metadata_service", "metadata_gateway"]:
    if module_name in sys.modules:
        del sys.modules[module_name]

from temporalio import activity, client, worker  # type: ignore
from temporalio.exceptions import ApplicationError  # type: ignore
from metadata_service import __file__ as _metadata_service_file
from metadata_service.cache.manager import MetadataCacheConfig, MetadataCacheManager
from metadata_service.collector import MetadataCollectionService, MetadataServiceConfig
from metadata_service.planning import plan_metadata_jobs
from metadata_service.repository import CacheMetadataRepository
from ingestion import run_ingestion_unit as _run_ingestion_unit
from preview import preview_dataset as _preview_via_endpoint
from staging import stage_records

if ROOT not in Path(_metadata_service_file).resolve().parents:
    raise RuntimeError(
        f"metadata_service resolved to {_metadata_service_file}, expected under {ROOT}."
    )

@dataclass
class CollectionJobRequest:
    runId: str
    endpointId: str
    sourceId: str
    endpointName: str
    connectionUrl: str
    schemas: List[str]
    projectId: Optional[str] = None
    labels: Optional[List[str]] = None
    config: Optional[Dict[str, Any]] = None


@dataclass
class CatalogRecordOutput:
    id: str
    projectId: Optional[str]
    domain: str
    labels: List[str]
    payload: Dict[str, Any]


@dataclass
class CollectionJobResult:
    recordsPath: Optional[str]
    recordCount: int
    logs: List[Dict[str, Any]]


@dataclass
class PreviewRequest:
    datasetId: str
    schema: str
    table: str
    templateId: str
    parameters: Dict[str, Any]
    connectionUrl: Optional[str] = None
    limit: Optional[int] = 50


@dataclass
class IngestionUnitRequest:
    endpointId: str
    unitId: str
    sinkId: Optional[str] = None
    checkpoint: Optional[Dict[str, Any]] = None
    stagingProviderId: Optional[str] = None
    policy: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None
    dataMode: Optional[str] = None
    sinkEndpointId: Optional[str] = None
    cdmModelId: Optional[str] = None
    filter: Optional[Dict[str, Any]] = None
    transientState: Optional[Dict[str, Any]] = None
    transientStateVersion: Optional[str] = None


@dataclass
class IngestionUnitResult:
    newCheckpoint: Optional[Dict[str, Any]]
    stats: Dict[str, Any]
    records: Optional[List[Dict[str, Any]]] = None
    transientState: Optional[Dict[str, Any]] = None
    stagingPath: Optional[str] = None
    stagingProviderId: Optional[str] = None


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
            pass
    return path


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


def _run_ingestion_unit_sync(request: IngestionUnitRequest) -> Dict[str, Any]:
    logger = ActivityLogger()
    logger.info(
        event="ingestion_unit_start",
        endpoint_id=request.endpointId,
        unit_id=request.unitId,
        sink_id=request.sinkId,
        staging_provider=request.stagingProviderId or "in_memory",
    )
    normalized_mode = (request.mode or "").upper()
    checkpoint = None if normalized_mode == "FULL" else request.checkpoint
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

    result = resp.get("result")
    stats = resp.get("stats")
    if result is None:
        stats = stats or {"note": "ingestion_noop", "unitId": request.unitId}
        return IngestionUnitResult(newCheckpoint=checkpoint, stats=stats).__dict__

    records = resp.get("records") or []
    staging_path, staging_provider = stage_records(records, request.stagingProviderId)
    records_payload: Optional[List[Dict[str, Any]]] = None
    if staging_path is None and str(request.dataMode or "").lower() != "cdm":
        records_payload = records
    logger.info(
        event="ingestion_complete",
        endpoint_id=request.endpointId,
        unit_id=request.unitId,
        template_id=template_id,
        stats=result.stats,
    )
    return IngestionUnitResult(
        newCheckpoint=result.cursor,
        stats=result.stats,
        records=records_payload,
        transientState=getattr(result, "transient_state", None),
        stagingPath=staging_path,
        stagingProviderId=staging_provider,
    ).__dict__


@activity.defn(name="collectCatalogSnapshots")
async def collect_catalog_snapshots(request: CollectionJobRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_collect_catalog_snapshots_sync, request)


def _preview_dataset_sync(request: PreviewRequest) -> Dict[str, Any]:
    if _is_seed_preview_request(request):
        raise ApplicationError(
            "Seeded catalog datasets only support cached preview rows.",
            type="SampleDatasetPreview",
            non_retryable=True,
        )
    template_id = (request.templateId or "").strip()
    parameters = request.parameters if isinstance(request.parameters, dict) else {}
    if not template_id:
        raise ApplicationError("templateId is required for preview", type="PreviewTemplateMissing", non_retryable=True)

    dataset_id = request.datasetId
    schema = request.schema or "default"
    table = request.table or dataset_id
    limit = max(1, min(int(request.limit or 50), 200))
    result = _preview_via_endpoint(
        template_id=template_id,
        parameters=parameters,
        dataset_id=dataset_id,
        schema=schema,
        table=table,
        limit=limit,
        connection_url=request.connectionUrl,
    )
    return result


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
    return await asyncio.to_thread(_preview_dataset_sync, request)


@activity.defn(name="runIngestionUnit")
async def run_ingestion_unit(request: IngestionUnitRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_run_ingestion_unit_sync, request)


async def main() -> None:
    temporal_address = os.getenv("TEMPORAL_ADDRESS", "127.0.0.1:7233")
    namespace = os.getenv("TEMPORAL_NAMESPACE", "default")
    task_queue = os.getenv("METADATA_PYTHON_TASK_QUEUE", "metadata-python")
    temporal_client = await client.Client.connect(temporal_address, namespace=namespace)
    worker_instance = worker.Worker(
        temporal_client,
        task_queue=task_queue,
        activities=[collect_catalog_snapshots, preview_dataset, run_ingestion_unit],
    )
    await worker_instance.run()


if __name__ == "__main__":
    asyncio.run(main())
