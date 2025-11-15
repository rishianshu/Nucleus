from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from metadata_service.models import (
    CatalogSnapshot,
    DataSourceMetadata,
    DatasetConstraint,
    DatasetConstraintField,
    DatasetMetadata,
    DatasetStatistics,
    SchemaField,
    SchemaFieldStatistics,
)
from metadata_service.normalizers.base import MetadataNormalizer
from metadata_service.utils import safe_upper


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
            name=dataset_name,
            data_source=data_source,
            dataset=dataset_descriptor,
            environment=environment,
            schema_fields=schema_fields,
            statistics=dataset_stats,
            constraints=dataset_constraints,
            raw_vendor=raw,
            extras={k: v for k, v in raw.items() if k not in {"schema", "table", "columns", "column_statistics", "constraints", "table_statistics"}},
        )

    def _build_field_stats(self, row: Dict[str, Any]) -> SchemaFieldStatistics:
        histogram = None
        bounds = row.get("histogram_bounds")
        if bounds:
            histogram = {"type": "histogram", "bounds": bounds}
        return SchemaFieldStatistics(
            distinct_count=self._safe_distinct(row.get("n_distinct")),
            null_count=self._safe_null_count(row.get("null_frac")),
            average_length=self._safe_float(row.get("avg_width")),
            histogram=histogram,
            extras={
                "most_common_vals": row.get("most_common_vals"),
                "most_common_freqs": row.get("most_common_freqs"),
            },
        )

    def _safe_distinct(self, value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            if isinstance(value, (float, int)) and value > 0:
                return int(value)
            return None
        except (TypeError, ValueError):
            return None

    def _safe_null_count(self, value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            frac = float(value)
            if frac < 0:
                return None
            return int(frac * 100)
        except (TypeError, ValueError):
            return None

    def _build_dataset_stats(self, row: Optional[Dict[str, Any]]) -> Optional[DatasetStatistics]:
        if not row:
            return None
        return DatasetStatistics(
            record_count=self._safe_int(row.get("row_estimate")),
            storage_blocks=self._safe_int(row.get("total_pages")),
            average_record_size=self._safe_int(row.get("avg_row_len")),
            extras={k: v for k, v in row.items() if k not in {"row_estimate", "total_pages", "avg_row_len"}},
        )

    def _build_constraints(self, raw_constraints: Optional[List[Dict[str, Any]]]) -> List[DatasetConstraint]:
        if not raw_constraints:
            return []
        constraints: List[DatasetConstraint] = []
        for row in raw_constraints:
            columns = [
                DatasetConstraintField(field=col.get("column_name"), position=self._safe_int(col.get("position")))
                for col in row.get("columns", [])
                if col.get("column_name")
            ]
            constraints.append(
                DatasetConstraint(
                    name=row.get("constraint_name"),
                    constraint_type=row.get("constraint_type"),
                    status=row.get("constraint_status"),
                    deferrable=row.get("is_deferrable"),
                    deferred=row.get("initially_deferred"),
                    delete_rule=row.get("delete_rule"),
                    referenced_constraint=row.get("referenced_constraint"),
                    fields=columns,
                    extras={k: v for k, v in row.items() if k not in {"columns"}},
                )
            )
        return constraints

    def _safe_int(self, value: Any) -> Optional[int]:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _safe_float(self, value: Any) -> Optional[float]:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None


__all__ = ["PostgresMetadataNormalizer"]
