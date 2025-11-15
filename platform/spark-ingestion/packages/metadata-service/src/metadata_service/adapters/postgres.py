from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from metadata_service.models import CatalogSnapshot
from metadata_service.normalizers import PostgresMetadataNormalizer
from metadata_service.utils import collect_rows, escape_literal

try:
    from runtime_common.endpoints.base import MetadataSubsystem  # type: ignore
    from runtime_common.tools.base import QueryRequest  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - standalone usage fallback
    MetadataSubsystem = object  # type: ignore[misc,assignment]
    QueryRequest = object  # type: ignore[misc,assignment]

if TYPE_CHECKING:  # pragma: no cover
    from runtime_common.endpoints.jdbc_postgres import PostgresEndpoint


class PostgresMetadataSubsystem(MetadataSubsystem):
    """Metadata subsystem for Postgres sources."""

    def __init__(self, endpoint: "PostgresEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = PostgresMetadataNormalizer()

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
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
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
          rc.delete_rule,
          kcu.column_name,
          kcu.ordinal_position
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        LEFT JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
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
                    "referenced_constraint": row.get("referenced_constraint"),
                    "columns": [],
                },
            )
            if row.get("column_name"):
                entry["columns"].append(
                    {
                        "column_name": row.get("column_name"),
                        "position": row.get("ordinal_position"),
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
