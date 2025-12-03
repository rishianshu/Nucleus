from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, TYPE_CHECKING

from endpoint_service.endpoints.oracle.normalizer import OracleMetadataNormalizer
from endpoint_service.metadata import collect_rows, escape_literal, safe_upper
from ingestion_models.metadata import (
    CatalogSnapshot,
    MetadataConfigValidationResult,
    MetadataPlanningResult,
    MetadataProducer,
    MetadataRecord,
    MetadataRequest,
)

try:
    from ingestion_models.endpoints import MetadataSubsystem  # type: ignore
    from endpoint_service.tools.base import QueryRequest  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - standalone usage
    MetadataSubsystem = object  # type: ignore[misc,assignment]
    QueryRequest = object  # type: ignore[misc,assignment]

if TYPE_CHECKING:  # pragma: no cover
    from endpoint_service.endpoints.oracle.jdbc_oracle import OracleEndpoint


class OracleMetadataSubsystem(MetadataSubsystem, MetadataProducer):
    """Metadata subsystem for Oracle sources."""

    DEFAULT_ENVIRONMENT_PROBES: List[Dict[str, str]] = [
        {
            "name": "instance",
            "sql": """
                SELECT INSTANCE_NAME, VERSION, HOST_NAME, STARTUP_TIME, STATUS
                FROM V$INSTANCE
            """,
        },
        {
            "name": "version_banner",
            "sql": "SELECT BANNER FROM V$VERSION ORDER BY BANNER",
        },
        {
            "name": "component_versions",
            "sql": """
                SELECT PRODUCT, VERSION, STATUS
                FROM PRODUCT_COMPONENT_VERSION
                ORDER BY PRODUCT
            """,
        },
    ]

    _ENVIRONMENT_CACHE: Dict[str, Dict[str, Any]] = {}

    def __init__(self, endpoint: "OracleEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = OracleMetadataNormalizer()
        self._producer_id = f"{self.endpoint.DIALECT}:{self.endpoint.schema}.{self.endpoint.table}"

    # ------------------------------------------------------------------ MetadataProducer protocol --
    @property
    def producer_id(self) -> str:
        return self._producer_id

    def supports(self, request: MetadataRequest) -> bool:
        target_ns = (request.target.namespace or "").lower()
        target_entity = (request.target.entity or "").lower().replace(".", "_")
        schema = (self.endpoint.schema or "").lower()
        table = (self.endpoint.table or "").lower().replace(".", "_")
        schema_match = not target_ns or target_ns == schema
        table_match = not target_entity or target_entity == table
        return schema_match and table_match

    def produce(self, request: MetadataRequest) -> Iterable[MetadataRecord]:
        config = dict(request.config or {})
        probe_error = None
        try:
            environment = self.probe_environment(config=config)
        except Exception as exc:
            probe_error = str(exc)
            environment = {}
        snapshot = self.collect_snapshot(request=request, environment=environment)
        produced_at = datetime.now(timezone.utc)
        extras: Dict[str, Any] = {"environment": environment, "refresh_requested": request.refresh}
        if probe_error:
            extras["environment_probe_error"] = probe_error
        record = MetadataRecord(
            target=request.target,
            kind="catalog_snapshot",
            payload=snapshot,
            produced_at=produced_at,
            producer_id=self.producer_id,
            version=None,
            quality={},
            extras=extras,
        )
        return [record]

    # ------------------------------------------------------------------ protocol --
    def capabilities(self) -> Dict[str, Any]:
        return {
            "sections": [
                "environment",
                "schema_fields",
                "statistics",
                "schema_field_statistics",
                "comments",
                "constraints",
            ],
            "supports_query_overrides": True,
            "supports_version_sensitive_queries": True,
        }

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]:
        config = dict(config or {})
        probes = self._environment_probe_definitions(config)
        key = repr(
            (
                self.endpoint.jdbc_cfg.get("url"),
                self.endpoint.jdbc_cfg.get("user"),
                tuple((probe.get("name"), probe.get("sql")) for probe in probes),
                json.dumps(config, sort_keys=True, default=str),
            )
        )
        cached = self._ENVIRONMENT_CACHE.get(key)
        if cached is not None:
            return cached
        info: Dict[str, Any] = {
            "dialect": self.endpoint.jdbc_cfg.get("dialect", self.endpoint.DIALECT),
            "driver": self.endpoint.jdbc_cfg.get("driver"),
        }
        executed: List[str] = []
        for probe in probes:
            name = probe.get("name") or "probe"
            sql = probe.get("sql")
            if not sql:
                continue
            rows = self._run_metadata_query(sql)
            if not rows:
                continue
            executed.append(name)
            if name == "instance":
                info["instance"] = rows[0]
                info["database_version"] = rows[0].get("version")
            elif name == "version_banner":
                info["banners"] = [row.get("banner") for row in rows if isinstance(row, dict)]
            elif name == "component_versions":
                info["components"] = rows
                if "database_version" not in info:
                    info["database_version"] = rows[0].get("version")
            else:
                info.setdefault("additional_probes", {})[name] = rows
        info["probe_sequence"] = executed
        self._ENVIRONMENT_CACHE[key] = info
        return info

    def collect_snapshot(
        self,
        *,
        request: MetadataRequest,
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
        owner = safe_upper(self.endpoint.schema)
        rel = safe_upper(self.endpoint.table)
        config = dict(request.config or {})
        environment = dict(environment or {})

        raw: Dict[str, Any] = {
            "source": self.endpoint.jdbc_cfg.get("dialect", self.endpoint.DIALECT),
            "schema": owner,
            "table": rel,
            "environment": environment,
        }
        queries_used: Dict[str, str] = {}

        if self._section_enabled("schema_fields", config, aliases=["columns"]):
            sql = self._resolve_query("columns", self._columns_sql(owner, rel), config, environment)
            raw["columns"] = self._run_metadata_query(sql)
            queries_used["columns"] = sql
        if self._section_enabled("dataset_statistics", config, aliases=["statistics"]):
            sql = self._resolve_query("statistics", self._table_stats_sql(owner, rel), config, environment)
            rows = self._run_metadata_query(sql)
            raw["statistics"] = rows[0] if rows else {}
            queries_used["statistics"] = sql
        if self._section_enabled("schema_field_statistics", config, aliases=["column_statistics"]):
            sql = self._resolve_query("column_statistics", self._column_stats_sql(owner, rel), config, environment)
            raw["column_statistics"] = self._run_metadata_query(sql)
            queries_used["column_statistics"] = sql
        if self._section_enabled("comments", config):
            table_sql, column_sql = self._comments_sql(owner, rel)
            table_sql = self._resolve_query("table_comments", table_sql, config, environment)
            column_sql = self._resolve_query("column_comments", column_sql, config, environment)
            table_comments = self._run_metadata_query(table_sql)
            column_comments = self._run_metadata_query(column_sql)
            raw["comments"] = {
                "table": table_comments[0] if table_comments else {},
                "columns": {row.get("column_name"): row for row in column_comments if isinstance(row, dict)},
            }
            queries_used["table_comments"] = table_sql
            queries_used["column_comments"] = column_sql
        if self._section_enabled("constraints", config):
            sql = self._resolve_query("constraints", self._constraints_sql(owner, rel), config, environment)
            raw["constraints"] = self._fetch_constraints_from_query(sql)
            queries_used["constraints"] = sql

        if queries_used:
            raw.setdefault("debug", {})["queries"] = queries_used

        snapshot = self._normalizer.normalize(
            raw=raw,
            environment=environment,
            config=config,
            endpoint_descriptor=self.endpoint.describe(),
        )
        snapshot.debug.setdefault("metadata_capabilities", self.capabilities())
        return snapshot

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        normalized = dict(parameters or {})
        return MetadataConfigValidationResult(ok=True, normalized_parameters=normalized)

    def plan_metadata_jobs(
        self,
        *,
        parameters: Dict[str, Any],
        request: Any,
        logger,
    ) -> MetadataPlanningResult:
        from endpoint_service.endpoints.jdbc.jdbc_planner import plan_jdbc_metadata_jobs

        return plan_jdbc_metadata_jobs(parameters, request, logger)

    # ------------------------------------------------------------------ helpers --
    def _environment_probe_definitions(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        use_defaults = not config.get("skip_default_probes", False)
        probes: Dict[str, Dict[str, Any]] = {}
        if use_defaults:
            for entry in self.DEFAULT_ENVIRONMENT_PROBES:
                probes[entry["name"]] = dict(entry)
        extra = config.get("environment_probes") or config.get("additional_probes") or []
        if isinstance(extra, dict):
            extra = [extra]
        for entry in extra:
            name = entry.get("name")
            sql = entry.get("sql")
            if not name or not sql:
                continue
            probes[name] = dict(entry)
        ordered_names = config.get("probe_order")
        if isinstance(ordered_names, (list, tuple)):
            ordered = [probes[name] for name in ordered_names if name in probes]
            for name, entry in probes.items():
                if name not in ordered_names:
                    ordered.append(entry)
            return ordered
        return list(probes.values())

    def _section_enabled(self, section: str, config: Dict[str, Any], aliases: Optional[List[str]] = None) -> bool:
        names = [section] + list(aliases or [])
        include = config.get("include_sections")
        if isinstance(include, (list, tuple, set)):
            include_set = {str(item).lower() for item in include}
            if any(name.lower() in include_set for name in names):
                return True
            return False
        exclude = config.get("exclude_sections")
        if isinstance(exclude, (list, tuple, set)):
            exclude_set = {str(item).lower() for item in exclude}
            if any(name.lower() in exclude_set for name in names):
                return False
        return True

    def _resolve_query(
        self,
        section: str,
        default_sql: str,
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> str:
        overrides = config.get("query_overrides") or {}
        if not isinstance(overrides, dict):
            overrides = {}
        section_override = overrides.get(section) or overrides.get(section.upper())
        if not section_override:
            return default_sql
        if isinstance(section_override, str):
            return section_override
        sql = section_override.get("sql")
        if not isinstance(sql, str):
            return default_sql
        return sql

    def _columns_sql(self, owner: str, table: str) -> str:
        return f"""
            SELECT
                OWNER,
                TABLE_NAME,
                COLUMN_NAME,
                DATA_TYPE,
                DATA_LENGTH,
                DATA_PRECISION,
                DATA_SCALE,
                NULLABLE,
                DATA_DEFAULT,
                COLUMN_ID,
                CHAR_USED
            FROM ALL_TAB_COLUMNS
            WHERE OWNER = '{escape_literal(owner)}'
              AND TABLE_NAME = '{escape_literal(table)}'
            ORDER BY COLUMN_ID
        """

    def _table_stats_sql(self, owner: str, table: str) -> str:
        return f"""
            SELECT
                OWNER,
                TABLE_NAME,
                NUM_ROWS,
                BLOCKS,
                AVG_ROW_LEN,
                SAMPLE_SIZE,
                LAST_ANALYZED,
                STALE_STATS,
                GLOBAL_STATS,
                USER_STATS,
                TEMPORARY,
                PARTITIONED
            FROM ALL_TAB_STATISTICS
            WHERE OWNER = '{escape_literal(owner)}'
              AND TABLE_NAME = '{escape_literal(table)}'
              AND PARTITION_NAME IS NULL
        """

    def _column_stats_sql(self, owner: str, table: str) -> str:
        return f"""
            SELECT
                OWNER,
                TABLE_NAME,
                COLUMN_NAME,
                NUM_DISTINCT,
                NUM_NULLS,
                DENSITY,
                AVG_COL_LEN,
                HISTOGRAM,
                LAST_ANALYZED,
                LOW_VALUE,
                HIGH_VALUE,
                LOW_VALUE_LENGTH,
                HIGH_VALUE_LENGTH
            FROM ALL_TAB_COL_STATISTICS
            WHERE OWNER = '{escape_literal(owner)}'
              AND TABLE_NAME = '{escape_literal(table)}'
              AND PARTITION_NAME IS NULL
        """

    def _comments_sql(self, owner: str, table: str) -> tuple[str, str]:
        table_sql = f"""
            SELECT COMMENTS
            FROM ALL_TAB_COMMENTS
            WHERE OWNER = '{escape_literal(owner)}'
              AND TABLE_NAME = '{escape_literal(table)}'
        """
        column_sql = f"""
            SELECT COLUMN_NAME, COMMENTS
            FROM ALL_COL_COMMENTS
            WHERE OWNER = '{escape_literal(owner)}'
              AND TABLE_NAME = '{escape_literal(table)}'
        """
        return table_sql, column_sql

    def _constraints_sql(self, owner: str, table: str) -> str:
        return f"""
            SELECT
                c.CONSTRAINT_NAME,
                c.CONSTRAINT_TYPE,
                c.STATUS,
                c.DEFERRABLE,
                c.DEFERRED,
                c.VALIDATED,
                c.GENERATED,
                c.BAD,
                c.RELY,
                c.NOVALIDATE,
                c.VIEW_RELATED,
                cols.COLUMN_NAME,
                cols.POSITION
            FROM ALL_CONSTRAINTS c
            JOIN ALL_CONS_COLUMNS cols
              ON c.OWNER = cols.OWNER
             AND c.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
            WHERE c.OWNER = '{escape_literal(owner)}'
              AND c.TABLE_NAME = '{escape_literal(table)}'
        """

    def _fetch_constraints_from_query(self, sql: str) -> Dict[str, Any]:
        rows = self._run_metadata_query(sql)
        constraints: Dict[str, Any] = {}
        for row in rows:
            name = row.get("constraint_name")
            if not name:
                continue
            entry = constraints.setdefault(
                name,
                {
                    "constraint_name": name,
                    "constraint_type": row.get("constraint_type"),
                    "status": row.get("status"),
                    "deferrable": row.get("deferrable"),
                    "deferred": row.get("deferred"),
                    "validated": row.get("validated"),
                    "generated": row.get("generated"),
                    "bad": row.get("bad"),
                    "rely": row.get("rely"),
                    "novalidate": row.get("novalidate"),
                    "view_related": row.get("view_related"),
                    "columns": [],
                },
            )
            entry["columns"].append(
                {
                    "column_name": row.get("column_name"),
                    "position": row.get("position"),
                }
            )
        return constraints

    def _run_metadata_query(self, sql: str) -> List[Dict[str, Any]]:
        request = QueryRequest(statement=sql, params={})
        result = self.endpoint.tool.execute(request, cache=False)
        if hasattr(result, "collect"):
            return collect_rows(result)
        rows = getattr(result, "rows", None)
        if rows is None:
            return []
        return collect_rows(rows)
