#!/usr/bin/env python3
"""Temporal worker that runs metadata collection and preview activities."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PACKAGES_DIR = ROOT / "packages"

PACKAGE_ROOTS = [
    PACKAGES_DIR / "runtime-common" / "src",
    PACKAGES_DIR / "core" / "src",
    PACKAGES_DIR / "metadata-service" / "src",
    PACKAGES_DIR / "metadata-gateway" / "src",
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
from metadata_service import __file__ as _metadata_service_file
from metadata_service.cache.manager import MetadataCacheConfig, MetadataCacheManager
from metadata_service.collector import MetadataCollectionService, MetadataJob, MetadataServiceConfig
from metadata_service.repository import CacheMetadataRepository
from metadata_service.utils import collect_rows, safe_upper, to_serializable
from runtime_core import MetadataTarget
from runtime_common.endpoints.base import MetadataCapableEndpoint  # type: ignore
from runtime_common.endpoints.factory import EndpointFactory
from runtime_common.tools.sqlalchemy import SQLAlchemyTool

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
    connectionUrl: str
    limit: Optional[int] = 50


@dataclass
class IngestionUnitRequest:
    endpointId: str
    unitId: str
    sinkId: Optional[str] = None
    checkpoint: Optional[Dict[str, Any]] = None
    stagingProviderId: Optional[str] = None
    policy: Optional[Dict[str, Any]] = None


@dataclass
class IngestionUnitResult:
    newCheckpoint: Optional[Dict[str, Any]]
    stats: Dict[str, Any]


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


def _build_sqlalchemy_tool(connection_url: str) -> SQLAlchemyTool:
    cfg = {
        "runtime": {
            "sqlalchemy": {
                "url": connection_url,
            },
        },
    }
    return SQLAlchemyTool.from_config(cfg)


def _expand_tables(tool: SQLAlchemyTool, schemas: Iterable[str]) -> List[Dict[str, str]]:
    expanded: List[Dict[str, str]] = []
    sql = """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = :schema
          AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
          AND table_name NOT LIKE '_prisma%%'
        ORDER BY table_schema, table_name
    """
    for schema in schemas:
        rows = tool.execute_sql(sql, {"schema": schema})
        for row in rows:
            expanded.append({"schema": row["table_schema"], "table": row["table_name"]})
    return expanded


def _guess_dialect(connection_url: str) -> str:
    prefix = connection_url.split("://", 1)[0]
    if "+" in prefix:
        prefix = prefix.split("+", 1)[1]
    return prefix.lower()


def _build_jdbc_config(connection_url: str) -> Dict[str, Any]:
    dialect = _guess_dialect(connection_url)
    parsed = urlparse(connection_url)
    driver = {
        "postgresql": "org.postgresql.Driver",
        "postgres": "org.postgresql.Driver",
        "oracle": "oracle.jdbc.OracleDriver",
        "mssql": "com.microsoft.sqlserver.jdbc.SQLServerDriver",
    }.get(dialect, "")
    return {
        "url": connection_url,
        "user": parsed.username or "",
        "password": parsed.password or "",
        "dialect": dialect,
        "driver": driver,
        "host": parsed.hostname,
        "port": parsed.port,
        "database": parsed.path[1:] if parsed.path.startswith("/") else parsed.path or None,
    }


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


def _collect_catalog_snapshots_sync(request: CollectionJobRequest) -> Dict[str, Any]:
    logger = ActivityLogger()
    logger.info(event="metadata_collect_start", run_id=request.runId, endpoint=request.endpointName)
    tool = _build_sqlalchemy_tool(request.connectionUrl)
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

    tables = _expand_tables(tool, request.schemas or ["public"])
    if not tables:
        logger.warn(event="metadata_no_tables", schemas=request.schemas)
        return {"records": [], "logs": logger.entries}

    jdbc_cfg = _build_jdbc_config(request.connectionUrl)
    cfg = {"jdbc": jdbc_cfg}
    jobs: List[MetadataJob] = []
    for table in tables:
        table_cfg = {
            "schema": table["schema"],
            "table": table["table"],
            "mode": "full",
        }
        try:
            endpoint = EndpointFactory.build_source(cfg, table_cfg, tool)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warn(
                event="metadata_endpoint_build_failed",
                schema=table["schema"],
                dataset=table["table"],
                error=str(exc),
            )
            continue
        if not isinstance(endpoint, MetadataCapableEndpoint):
            logger.info(event="metadata_capability_missing", schema=table["schema"], dataset=table["table"])
            continue
        target = MetadataTarget(
            source_id=request.sourceId or request.endpointId,
            namespace=safe_upper(table["schema"]),
            entity=safe_upper(table["table"]),
        )
        jobs.append(MetadataJob(target=target, artifact=table_cfg, endpoint=endpoint))

    if not jobs:
        logger.warn(event="metadata_no_jobs_ready")
        return {"records": [], "logs": logger.entries}

    metadata_service.run(jobs)
    repository = CacheMetadataRepository(cache_manager)
    try:
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
            dataset_id = str(payload.get("id") or f"{job.target.namespace.lower()}_{job.target.entity.lower()}")
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
        logger.info(event="metadata_collect_complete", datasets=len(records))
        records_path = _write_records_manifest(records, request.runId)
        return CollectionJobResult(
            recordsPath=records_path,
            recordCount=len(records),
            logs=logger.entries,
        ).__dict__
    finally:
        import shutil

        tool.stop()
        shutil.rmtree(temp_dir, ignore_errors=True)


def _run_ingestion_unit_sync(request: IngestionUnitRequest) -> Dict[str, Any]:
    """
    Placeholder ingestion worker that will call the Spark ingestion runtime in follow-up slugs.
    For now it records telemetry and echoes the prior checkpoint so TS can persist run metadata.
    """
    logger = ActivityLogger()
    logger.info(
        event="ingestion_unit_start",
        endpoint_id=request.endpointId,
        unit_id=request.unitId,
        sink_id=request.sinkId,
        staging_provider=request.stagingProviderId or "in_memory",
    )
    completed_at = datetime.now(timezone.utc).isoformat()
    stats = {
        "note": "python_ingestion_worker_stub",
        "stagingProviderId": request.stagingProviderId or "in_memory",
        "unitId": request.unitId,
        "completedAt": completed_at,
    }
    logger.info(event="ingestion_unit_complete", endpoint_id=request.endpointId, unit_id=request.unitId, stats=stats)
    return IngestionUnitResult(
        newCheckpoint=request.checkpoint or {"lastRunAt": completed_at},
        stats=stats,
    ).__dict__


@activity.defn(name="collectCatalogSnapshots")
async def collect_catalog_snapshots(request: CollectionJobRequest) -> Dict[str, Any]:
    return await asyncio.to_thread(_collect_catalog_snapshots_sync, request)


def _preview_dataset_sync(request: PreviewRequest) -> Dict[str, Any]:
    if not request.connectionUrl:
        raise ValueError("connectionUrl is required for dataset preview")
    tool = _build_sqlalchemy_tool(request.connectionUrl)
    try:
        schema = request.schema.strip('"')
        table = request.table.strip('"')
        limit = max(1, min(int(request.limit or 50), 500))
        jdbc_cfg = _build_jdbc_config(request.connectionUrl)
        cfg = {"jdbc": jdbc_cfg}
        table_cfg = {
            "schema": schema,
            "table": table,
            "mode": "full",
            "query_sql": f'SELECT * FROM "{schema}"."{table}" LIMIT {limit}',
        }
        endpoint = EndpointFactory.build_source(cfg, table_cfg, tool)
        rows = [to_serializable(row) for row in collect_rows(endpoint.read_full())]
        sampled_at = datetime.now(timezone.utc).isoformat()
        return {
            "rows": rows,
            "sampledAt": sampled_at,
        }
    finally:
        tool.stop()


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
