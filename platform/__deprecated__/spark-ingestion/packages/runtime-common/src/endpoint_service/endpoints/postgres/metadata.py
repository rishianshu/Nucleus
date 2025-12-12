from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, TYPE_CHECKING

from endpoint_service.endpoints.postgres.normalizer import PostgresMetadataNormalizer
from endpoint_service.metadata import collect_rows, escape_literal
from ingestion_models.endpoints import MetadataSubsystem
from endpoint_service.tools.base import QueryRequest
from ingestion_models.metadata import (
    CatalogSnapshot,
    MetadataConfigValidationResult,
    MetadataPlanningResult,
    MetadataProducer,
    MetadataRecord,
    MetadataRequest,
)

if TYPE_CHECKING:  # pragma: no cover
    from endpoint_service.endpoints.postgres.jdbc_postgres import PostgresEndpoint


class PostgresMetadataSubsystem(MetadataSubsystem, MetadataProducer):
    """Metadata subsystem for Postgres sources."""

    def __init__(self, endpoint: "PostgresEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = PostgresMetadataNormalizer()
        self._producer_id = f"postgres:{self.endpoint.schema}.{self.endpoint.table}"

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

    def capabilities(self) -> Dict[str, Any]:
        return {
            "sections": [
                "environment",
                "schema_fields",
                "schema_field_statistics",
                "statistics",
                "constraints",
            ],
            "supports_query_overrides": False,
            "supports_version_sensitive_queries": False,
        }

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]:
        probes = [
            {
                "sql": "SELECT current_database() AS database_name, version() AS version_banner, current_setting('server_version') AS server_version, inet_server_addr()::text AS hostname",
            },
            {
                "sql": "SELECT current_setting('max_connections') AS max_connections, current_setting('search_path') AS search_path",
            },
        ]
        info: Dict[str, Any] = {"dialect": "postgres"}
        for probe in probes:
            sql = probe.get("sql")
            if not sql:
                continue
            rows = self._run_metadata_query(sql)
            if not rows:
                continue
            info.update(rows[0])
        info.setdefault("database_name", self.endpoint.schema.split(".", 1)[0] if self.endpoint.schema else None)
        return info

    def collect_snapshot(
        self,
        *,
        request: MetadataRequest,
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
        config = dict(request.config or {})
        schema = self.endpoint.schema
        table = self.endpoint.table
        raw: Dict[str, Any] = {
            "schema": schema,
            "table": table,
            "source": "postgres",
        }

        raw["columns"] = self._load_columns(schema, table)
        raw["column_statistics"] = self._load_column_stats(schema, table)
        raw["constraints"] = self._load_constraints(schema, table)
        raw.update(self._load_table_metadata(schema, table))

        return self._normalizer.normalize(
            raw=raw,
            environment=environment,
            config=config,
            endpoint_descriptor={
                "schema": schema,
                "table": table,
                "dialect": "postgres",
            },
        )

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

    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]:
        # Metadata subsystem does not perform data ingestion; return noop status.
        return {"status": "noop", "checkpoint": checkpoint}

    def preview_dataset(self, dataset_id: str, limit: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        target = dataset_id or f"{self.endpoint.schema}.{self.endpoint.table}"
        schema, table = (target.split(".", 1) + [None])[:2]
        if table is None:
            table = schema
            schema = self.endpoint.schema
        schema = schema or self.endpoint.schema
        table = table or self.endpoint.table
        if not schema or not table:
            return []
        sql = f'SELECT * FROM "{escape_literal(schema)}"."{escape_literal(table)}" LIMIT {max(1, limit)}'
        return self._run_metadata_query(sql)

    # ------------------------------------------------------------------ helpers --
    def _load_columns(self, schema: str, table: str) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT
          cols.column_name,
          cols.data_type,
          cols.udt_name,
          cols.is_nullable,
          cols.column_default,
          cols.character_maximum_length,
          cols.numeric_precision,
          cols.numeric_scale,
          cols.datetime_precision,
          cols.ordinal_position,
          pgd.description
        FROM information_schema.columns cols
        LEFT JOIN pg_class c
          ON c.relname = cols.table_name
        LEFT JOIN pg_namespace n
          ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute attr
          ON attr.attrelid = c.oid AND attr.attname = cols.column_name
        LEFT JOIN pg_description pgd
          ON pgd.objoid = c.oid AND pgd.objsubid = attr.attnum
        WHERE cols.table_schema = '{escape_literal(schema)}'
          AND cols.table_name = '{escape_literal(table)}'
        ORDER BY cols.ordinal_position
        """
        return self._run_metadata_query(sql)

    def _load_column_stats(self, schema: str, table: str) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT
          attname AS column_name,
          n_distinct,
          null_frac,
          avg_width,
          most_common_vals,
          most_common_freqs,
          histogram_bounds
        FROM pg_stats
        WHERE schemaname = '{escape_literal(schema)}'
          AND tablename = '{escape_literal(table)}'
        """
        return self._run_metadata_query(sql)

    def _load_constraints(self, schema: str, table: str) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT
          tc.constraint_name,
          tc.constraint_type,
          tc.is_deferrable,
          tc.initially_deferred,
          tc.constraint_schema,
          rc.unique_constraint_name AS referenced_constraint,
          rc.unique_constraint_schema AS referenced_constraint_schema,
          rc.delete_rule,
          rc.update_rule,
          kcu.column_name,
          kcu.ordinal_position,
          ccu.table_schema AS referenced_table_schema,
          ccu.table_name AS referenced_table,
          ccu.column_name AS referenced_column,
          ccu.ordinal_position AS referenced_column_position
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        LEFT JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
        LEFT JOIN information_schema.key_column_usage ccu
          ON rc.unique_constraint_name = ccu.constraint_name
          AND rc.unique_constraint_schema = ccu.constraint_schema
          AND ccu.ordinal_position = kcu.ordinal_position
        WHERE tc.table_schema = '{escape_literal(schema)}'
          AND tc.table_name = '{escape_literal(table)}'
        ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        rows = self._run_metadata_query(sql)
        grouped: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            name = row.get("constraint_name")
            if not name:
                continue
            entry = grouped.setdefault(
                name,
                {
                    "constraint_name": name,
                    "constraint_type": row.get("constraint_type"),
                    "is_deferrable": row.get("is_deferrable"),
                    "initially_deferred": row.get("initially_deferred"),
                    "constraint_schema": row.get("constraint_schema"),
                    "constraint_status": None,
                    "delete_rule": row.get("delete_rule"),
                    "update_rule": row.get("update_rule"),
                    "referenced_constraint": row.get("referenced_constraint"),
                    "referenced_constraint_schema": row.get("referenced_constraint_schema"),
                    "referenced_table": None,
                    "referenced_fields": [],
                    "columns": [],
                },
            )
            if row.get("column_name"):
                if not entry.get("referenced_table") and row.get("referenced_table"):
                    ref_schema = row.get("referenced_table_schema")
                    ref_table = row.get("referenced_table")
                    entry["referenced_table"] = f"{ref_schema}.{ref_table}" if ref_schema else ref_table
                if row.get("referenced_column"):
                    entry["referenced_fields"].append(row.get("referenced_column"))
                entry["columns"].append(
                    {
                        "column_name": row.get("column_name"),
                        "position": row.get("ordinal_position"),
                        "referenced_column": row.get("referenced_column"),
                        "referenced_column_position": row.get("referenced_column_position"),
                    }
                )
        return list(grouped.values())

    def _load_table_metadata(self, schema: str, table: str) -> Dict[str, Any]:
        sql = f"""
        SELECT
          c.relkind,
          c.reltuples::bigint AS row_estimate,
          c.relpages AS total_pages,
          pg_total_relation_size(c.oid) AS total_bytes,
          pg_total_relation_size(c.oid) / NULLIF(GREATEST(c.reltuples, 1), 0) AS avg_row_len,
          obj_description(c.oid) AS table_description,
          EXISTS (
            SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisvalid
          ) AS has_indexes
        FROM pg_class c
        INNER JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '{escape_literal(schema)}'
          AND c.relname = '{escape_literal(table)}'
        LIMIT 1
        """
        rows = self._run_metadata_query(sql)
        if not rows:
            return {}
        row = rows[0]
        return {
            "table_description": row.get("table_description"),
            "table_type": self._map_relkind(row.get("relkind")),
            "has_indexes": row.get("has_indexes"),
            "table_statistics": {
                "row_estimate": row.get("row_estimate"),
                "total_pages": row.get("total_pages"),
                "total_bytes": row.get("total_bytes"),
                "avg_row_len": row.get("avg_row_len"),
            },
        }

    def _map_relkind(self, relkind: Any) -> str:
        mapping = {
            "r": "BASE TABLE",
            "v": "VIEW",
            "m": "MATERIALIZED VIEW",
        }
        return mapping.get(relkind, "BASE TABLE")

    def _run_metadata_query(self, sql: str) -> List[Dict[str, Any]]:
        request = QueryRequest(statement=sql, params={})
        result = self.endpoint.tool.execute(request, cache=False)
        if hasattr(result, "collect"):
            return collect_rows(result)
        rows = getattr(result, "rows", None)
        if rows is None:
            return []
        return collect_rows(rows)
