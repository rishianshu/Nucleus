from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from ingestion_models.metadata import (
    CatalogSnapshot,
    DataSourceMetadata,
    DatasetConstraint,
    DatasetConstraintField,
    DatasetMetadata,
    DatasetStatistics,
    SchemaField,
    SchemaFieldStatistics,
)
from ingestion_models.metadata.normalizers.base import MetadataNormalizer
from endpoint_service.metadata import safe_upper


class PostgresMetadataNormalizer(MetadataNormalizer):
    def normalize(
        self,
        *,
        raw: Dict[str, Any],
        environment: Dict[str, Any],
        config: Dict[str, Any],
        endpoint_descriptor: Dict[str, Any],
    ) -> CatalogSnapshot:
        schema = safe_upper(raw.get("schema") or endpoint_descriptor.get("schema") or "")
        dataset_name = safe_upper(raw.get("table") or endpoint_descriptor.get("table") or "")
        source = endpoint_descriptor.get("dialect") or raw.get("source") or "postgres"

        field_stats_lookup = {row["column_name"]: self._build_field_stats(row) for row in raw.get("column_statistics", []) if row.get("column_name")}

        schema_fields: List[SchemaField] = []
        for column in raw.get("columns", []):
            name = column.get("column_name")
            if not name:
                continue
            schema_fields.append(
                SchemaField(
                    name=name,
                    data_type=column.get("data_type"),
                    precision=self._safe_int(column.get("numeric_precision")),
                    scale=self._safe_int(column.get("numeric_scale")),
                    length=self._safe_int(column.get("character_maximum_length")),
                    nullable=str(column.get("is_nullable", "YES")).upper() == "YES",
                    default=column.get("column_default"),
                    comment=column.get("description"),
                    position=self._safe_int(column.get("ordinal_position")),
                    statistics=field_stats_lookup.get(name),
                    extras={
                        k: v
                        for k, v in column.items()
                        if k
                        not in {
                            "column_name",
                            "data_type",
                            "udt_name",
                            "is_nullable",
                            "column_default",
                            "character_maximum_length",
                            "numeric_precision",
                            "numeric_scale",
                            "datetime_precision",
                            "ordinal_position",
                            "description",
                        }
                    },
                )
            )

        dataset_stats = self._build_dataset_stats(raw.get("table_statistics"))
        dataset_constraints = self._build_constraints(raw.get("constraints"))

        data_source = DataSourceMetadata(
            id=environment.get("database_name"),
            name=environment.get("database_name") or endpoint_descriptor.get("dialect"),
            type="postgres",
            system=environment.get("hostname"),
            environment=environment.get("environment"),
            version=environment.get("server_version"),
            properties={
                "max_connections": environment.get("max_connections"),
                "search_path": environment.get("search_path"),
            },
            extras={
                k: v
                for k, v in environment.items()
                if k
                not in {
                    "database_name",
                    "server_version",
                    "hostname",
                    "environment",
                    "max_connections",
                    "search_path",
                }
            },
        )

        dataset_descriptor = DatasetMetadata(
            id=f"{schema}.{dataset_name}" if schema and dataset_name else dataset_name,
            name=f"{schema}.{dataset_name}" if schema and dataset_name else dataset_name,
            physical_name=f"{schema}.{dataset_name}" if schema and dataset_name else dataset_name,
            type="table" if raw.get("table_type", "").lower() != "view" else "view",
            source_id=data_source.id,
            location=f"{schema}.{dataset_name}" if schema and dataset_name else dataset_name,
            description=raw.get("table_description"),
            properties={
                "table_type": raw.get("table_type"),
                "has_indexes": raw.get("has_indexes"),
            },
        )

        schema_fields.sort(key=lambda field: (field.position if field.position is not None else 1_000_000, field.name))

        return CatalogSnapshot(
            source=source,
            schema=schema,
            name=dataset_descriptor.name,
            data_source=data_source,
            dataset=dataset_descriptor,
            schema_fields=schema_fields,
            statistics=dataset_stats,
            constraints=dataset_constraints,
            raw_vendor={
                "environment": environment,
                "table_statistics": raw.get("table_statistics"),
                "column_statistics": raw.get("column_statistics"),
            },
        )

    # ------------------------------------------------------------------ helpers --
    def _build_field_stats(self, entry: Dict[str, Any]) -> SchemaFieldStatistics:
        return SchemaFieldStatistics(
            distinct_count=self._safe_int(entry.get("n_distinct")),
            null_count=self._safe_int(entry.get("null_frac")),
            average_length=self._safe_float(entry.get("avg_width")),
            histogram=self._parse_histogram(entry.get("histogram_bounds")),
            extras={
                k: v
                for k, v in entry.items()
                if k not in {"column_name", "n_distinct", "null_frac", "avg_width", "histogram_bounds"}
            },
        )

    def _build_dataset_stats(self, stats: Optional[Dict[str, Any]]) -> Optional[DatasetStatistics]:
        if not isinstance(stats, dict):
            return None
        return DatasetStatistics(
            record_count=self._safe_int(stats.get("row_estimate")),
            storage_blocks=self._safe_int(stats.get("total_pages")),
            average_record_size=self._safe_int(stats.get("avg_row_len")),
            extras={
                k: v
                for k, v in stats.items()
                if k not in {"row_estimate", "total_pages", "avg_row_len", "table_description", "has_indexes", "table_type"}
            },
        )

    def _build_constraints(self, constraints: Optional[List[Dict[str, Any]]]) -> List[DatasetConstraint]:
        if not constraints:
            return []
        built: List[DatasetConstraint] = []
        for constraint in constraints:
            name = constraint.get("constraint_name")
            ctype = constraint.get("constraint_type")
            if not name or not ctype:
                continue
            fields = [
                DatasetConstraintField(field=field.get("column_name"), position=self._safe_int(field.get("position")))
                for field in constraint.get("columns", [])
                if field.get("column_name")
            ]
            referenced_fields = constraint.get("referenced_fields") or []
            built.append(
                DatasetConstraint(
                    name=name,
                    constraint_type=ctype,
                    deferrable=constraint.get("is_deferrable"),
                    deferred=constraint.get("initially_deferred"),
                    delete_rule=constraint.get("delete_rule"),
                    referenced_table=constraint.get("referenced_table"),
                    referenced_fields=[str(field) for field in referenced_fields if field],
                    referenced_constraint=constraint.get("referenced_constraint"),
                    fields=fields,
                )
            )
        return built

    def _parse_histogram(self, value: Any) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        if isinstance(value, str):
            entries = value.strip("{}").split(",")
            try:
                parsed = [float(entry) for entry in entries if entry]
                return {"bounds": parsed}
            except Exception:
                return None
        if isinstance(value, (list, tuple)):
            return {"bounds": list(value)}
        return None

    def _safe_int(self, value: Any) -> Optional[int]:
        try:
            return int(value)
        except Exception:
            return None

    def _safe_float(self, value: Any) -> Optional[float]:
        try:
            return float(value)
        except Exception:
            return None
