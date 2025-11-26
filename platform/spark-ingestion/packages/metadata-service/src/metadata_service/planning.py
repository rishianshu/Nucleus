"""Capability-driven metadata planning helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

from metadata_service.collector import MetadataJob
from metadata_service.utils import safe_upper
from runtime_common.endpoints.base import MetadataCapableEndpoint
from runtime_common.endpoints.factory import EndpointFactory
from runtime_common.endpoints.registry import get_endpoint_class
from runtime_common.tools.sqlalchemy import SQLAlchemyTool
from runtime_core import MetadataTarget


@dataclass
class MetadataPlanningResult:
    """Return value for capability-driven metadata planning."""

    jobs: List[MetadataJob]
    cleanup_callbacks: List[Callable[[], None]] = field(default_factory=list)


def plan_metadata_jobs(request: Any, logger) -> MetadataPlanningResult:
    """Plan metadata collection jobs for the given request.

    The planner inspects the endpoint template/capabilities and delegates to the
    appropriate strategy (HTTP/semantic vs. JDBC). Worker callers remain agnostic
    of template-specific logic.
    """

    config = getattr(request, "config", None) or {}
    template_id = _resolve_template_id(config)
    parameters = _normalize_parameters(config)
    endpoint_cls = get_endpoint_class(template_id) if template_id else None
    descriptor = endpoint_cls.descriptor() if endpoint_cls and hasattr(endpoint_cls, "descriptor") else None
    family = (descriptor.family or "") if descriptor else ""

    if family.upper() == "HTTP" and endpoint_cls is not None:
        return _plan_http_endpoint_jobs(endpoint_cls, parameters, request, logger)

    return _plan_jdbc_metadata_jobs(parameters, request, logger)


def _resolve_template_id(config: Dict[str, Any]) -> Optional[str]:
    keys = ("templateId", "template_id", "template")
    for key in keys:
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_parameters(config: Dict[str, Any]) -> Dict[str, Any]:
    params = config.get("parameters")
    if isinstance(params, dict):
        return dict(params)
    return {}


def _plan_http_endpoint_jobs(endpoint_cls, parameters: Dict[str, Any], request: Any, logger) -> MetadataPlanningResult:
    endpoint_cfg = dict(parameters or {})
    connection_url = getattr(request, "connectionUrl", None)
    if connection_url and "base_url" not in endpoint_cfg:
        endpoint_cfg["base_url"] = connection_url

    datasets = _discover_datasets(endpoint_cls, endpoint_cfg)
    if not datasets:
        logger.warn(event="metadata_no_http_datasets", endpoint=getattr(request, "endpointId", None))
        return MetadataPlanningResult(jobs=[])

    source_id = getattr(request, "sourceId", None) or getattr(request, "endpointId", None)
    project_id = getattr(request, "projectId", None)
    jobs: List[MetadataJob] = []
    for dataset_id in datasets:
        table_cfg = {
            "schema": _dataset_namespace(dataset_id).lower(),
            "table": _dataset_entity(dataset_id),
            "dataset": dataset_id,
            "mode": "full",
            "metadata_project_id": project_id,
        }
        endpoint = endpoint_cls(tool=None, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)
        target = MetadataTarget(
            source_id=source_id,
            namespace=safe_upper(_dataset_namespace(dataset_id)),
            entity=safe_upper(_dataset_entity(dataset_id)),
        )
        jobs.append(MetadataJob(target=target, artifact=table_cfg, endpoint=endpoint))

    return MetadataPlanningResult(jobs=jobs)


def _discover_datasets(endpoint_cls, endpoint_cfg: Dict[str, Any]) -> Sequence[str]:
    try:
        endpoint = endpoint_cls(tool=None, endpoint_cfg=endpoint_cfg, table_cfg={"schema": "catalog", "table": "dataset"})
    except Exception:
        return []
    metadata_subsystem = getattr(endpoint, "metadata_subsystem", None)
    if callable(metadata_subsystem):
        subsystem = metadata_subsystem()
    else:  # pragma: no cover - defensive fallback
        subsystem = metadata_subsystem
    if subsystem and hasattr(subsystem, "capabilities"):
        try:
            capabilities = subsystem.capabilities()
        except Exception:
            return []
        datasets = capabilities.get("datasets") if isinstance(capabilities, dict) else None
        if isinstance(datasets, (list, tuple)):
            return list(datasets)
    return []


def _dataset_namespace(dataset_id: str) -> str:
    if not dataset_id or "." not in dataset_id:
        return dataset_id or "DATASET"
    return dataset_id.split(".", 1)[0]


def _dataset_entity(dataset_id: str) -> str:
    if not dataset_id or "." not in dataset_id:
        return dataset_id or "DATASET"
    return dataset_id.split(".", 1)[1]


def _plan_jdbc_metadata_jobs(parameters: Dict[str, Any], request: Any, logger) -> MetadataPlanningResult:
    connection_url = getattr(request, "connectionUrl", None)
    if not connection_url:
        raise ValueError("connectionUrl is required for JDBC metadata collection")

    tool = _build_sqlalchemy_tool(connection_url)
    plan = MetadataPlanningResult(jobs=[], cleanup_callbacks=[tool.stop])
    schemas = getattr(request, "schemas", None) or ["public"]
    tables = _expand_tables(tool, schemas)
    if not tables:
        logger.warn(event="metadata_no_tables", schemas=schemas)
        return plan

    jdbc_cfg = _build_jdbc_config(connection_url)
    cfg = {"jdbc": jdbc_cfg}
    source_id = getattr(request, "sourceId", None) or getattr(request, "endpointId", None)
    jobs: List[MetadataJob] = []
    for table in tables:
        table_cfg = {
            "schema": table["schema"],
            "table": table["table"],
            "mode": "full",
        }
        try:
            endpoint = EndpointFactory.build_source(cfg, table_cfg, tool)
        except Exception as exc:
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
            source_id=source_id,
            namespace=safe_upper(table["schema"]),
            entity=safe_upper(table["table"]),
        )
        jobs.append(MetadataJob(target=target, artifact=table_cfg, endpoint=endpoint))

    plan.jobs = jobs
    return plan


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
    sql = (
        "\n        SELECT table_schema, table_name\n        FROM information_schema.tables\n        WHERE table_schema = :schema\n          AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')\n          AND table_name NOT LIKE '_prisma%%'\n        ORDER BY table_schema, table_name\n    "
    )
    for schema in schemas:
        rows = tool.execute_sql(sql, {"schema": schema})
        for row in rows:
            expanded.append({"schema": row["table_schema"], "table": row["table_name"]})
    return expanded


def _build_jdbc_config(connection_url: str) -> Dict[str, Any]:
    prefix = connection_url.split("://", 1)[0]
    if "+" in prefix:
        prefix = prefix.split("+", 1)[1]
    dialect = prefix.lower()
    parsed = _parse_url(connection_url)
    driver = {
        "postgresql": "org.postgresql.Driver",
        "postgres": "org.postgresql.Driver",
        "oracle": "oracle.jdbc.OracleDriver",
        "mssql": "com.microsoft.sqlserver.jdbc.SQLServerDriver",
    }.get(dialect, "")
    return {
        "url": connection_url,
        "user": parsed.get("username") or "",
        "password": parsed.get("password") or "",
        "dialect": dialect,
        "driver": driver,
        "host": parsed.get("hostname"),
        "port": parsed.get("port"),
        "database": parsed.get("database"),
    }


def _parse_url(connection_url: str) -> Dict[str, Any]:
    from urllib.parse import urlparse

    parsed = urlparse(connection_url)
    database = parsed.path[1:] if parsed.path.startswith("/") else parsed.path or None
    return {
        "username": parsed.username,
        "password": parsed.password,
        "hostname": parsed.hostname,
        "port": parsed.port,
        "database": database,
    }


__all__ = ["MetadataPlanningResult", "plan_metadata_jobs"]
