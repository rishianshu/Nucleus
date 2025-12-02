"""Shared JDBC metadata planning helper."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from metadata_service.collector import MetadataJob
from metadata_service.models import MetadataPlanningResult
from metadata_service.utils import safe_upper
from runtime_common.endpoints.base import MetadataCapableEndpoint
from runtime_common.endpoints.factory import EndpointFactory
from runtime_common.tools.sqlalchemy import SQLAlchemyTool
from runtime_core import MetadataTarget


def plan_jdbc_metadata_jobs(parameters: Dict[str, Any], request: Any, logger) -> MetadataPlanningResult:
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
    # Normalize common aliases to match registered templates
    if dialect == "postgresql":
        dialect = "postgres"
    parsed = _parse_url(connection_url)
    driver = {
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


__all__ = ["plan_jdbc_metadata_jobs"]
