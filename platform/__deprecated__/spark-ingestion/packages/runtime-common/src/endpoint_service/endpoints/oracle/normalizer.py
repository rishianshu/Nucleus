from __future__ import annotations

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


class OracleMetadataNormalizer(MetadataNormalizer):
    def normalize(
        self,
        *,
        raw: Dict[str, Any],
        environment: Dict[str, Any],
        config: Dict[str, Any],
        endpoint_descriptor: Dict[str, Any],
    ) -> CatalogSnapshot:
        owner = safe_upper(raw.get("owner") or endpoint_descriptor.get("schema") or "")
        table_name = safe_upper(raw.get("table") or endpoint_descriptor.get("table") or "")
        source = endpoint_descriptor.get("dialect") or raw.get("source") or "oracle"
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
                    precision=self._safe_int(column.get("data_precision")),
                    scale=self._safe_int(column.get("data_scale")),
                    length=self._safe_int(column.get("data_length")),
                    nullable=str(column.get("nullable", "Y")).upper() == "Y",
                    default=column.get("data_default"),
                    comment=column.get("comments"),
                    position=self._safe_int(column.get("column_id")),
                    statistics=field_stats_lookup.get(name),
                    extras={
                        k: v
                        for k, v in column.items()
                        if k
                        not in {
                            "owner",
                            "table_name",
                            "column_name",
                            "data_type",
                            "data_length",
                            "data_precision",
                            "data_scale",
                            "nullable",
                            "data_default",
                            "column_id",
                            "comments",
                        }
                    },
                )
            )

        dataset_constraints = self._build_constraints(raw.get("constraints"))

        data_source = DataSourceMetadata(
            id=environment.get("database_name") or owner,
            name=environment.get("database_name") or owner,
            type="oracle",
            system=environment.get("instance") or environment.get("hostname"),
            environment=environment.get("environment"),
            version=environment.get("database_version"),
            extras={
                k: v
                for k, v in environment.items()
                if k
                not in {"database_name", "database_version", "environment", "instance", "hostname", "probe_sequence", "components"}
            },
        )

        dataset_descriptor = DatasetMetadata(
            id=f"{owner}.{table_name}" if owner and table_name else table_name,
            name=f"{owner}.{table_name}" if owner and table_name else table_name,
            physical_name=f"{owner}.{table_name}" if owner and table_name else table_name,
            type="table" if raw.get("table_type", "").lower() != "view" else "view",
            source_id=data_source.id,
            location=f"{owner}.{table_name}" if owner and table_name else table_name,
            description=raw.get("table_comments"),
            properties={
                "tablespace_name": raw.get("tablespace_name"),
                "last_analyzed": raw.get("last_analyzed"),
            },
        )

        dataset_stats = self._build_dataset_stats(raw.get("table_statistics"))

        schema_fields.sort(key=lambda field: (field.position if field.position is not None else 1_000_000, field.name))

        return CatalogSnapshot(
            source=source,
            schema=owner,
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

    def _build_field_stats(self, row: Dict[str, Any]) -> SchemaFieldStatistics:
        return SchemaFieldStatistics(
            distinct_count=self._safe_int(row.get("num_distinct")),
            null_count=self._safe_int(row.get("num_nulls")),
            density=self._safe_float(row.get("density")),
            average_length=self._safe_float(row.get("avg_col_len")),
            histogram=self._build_histogram(row),
            last_analyzed=row.get("last_analyzed"),
            min_value=row.get("low_value"),
            max_value=row.get("high_value"),
            extras={k: v for k, v in row.items() if k not in {"column_name", "num_distinct", "num_nulls", "density", "avg_col_len", "histogram", "low_value", "high_value", "last_analyzed"}},
        )

    def _build_histogram(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        histogram_type = row.get("histogram")
        if not histogram_type or histogram_type.lower() == "none":
            return None
        return {
            "type": histogram_type,
            "endpoint_count": self._safe_int(row.get("endpoint_count")),
        }

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
            built.append(
                DatasetConstraint(
                    name=name,
                    constraint_type=ctype,
                    status=constraint.get("status"),
                    deferrable=constraint.get("deferrable"),
                    deferred=constraint.get("deferred"),
                    validated=constraint.get("validated"),
                    generated=constraint.get("generated"),
                    delete_rule=constraint.get("delete_rule"),
                    referenced_constraint=constraint.get("referenced_constraint"),
                    fields=fields,
                )
            )
        return built

    def _build_dataset_stats(self, stats: Optional[Dict[str, Any]]) -> Optional[DatasetStatistics]:
        if not isinstance(stats, dict):
            return None
        return DatasetStatistics(
            record_count=self._safe_int(stats.get("num_rows")),
            storage_blocks=self._safe_int(stats.get("blocks")),
            average_record_size=self._safe_int(stats.get("avg_row_len")),
            extras={k: v for k, v in stats.items() if k not in {"num_rows", "blocks", "avg_row_len"}},
        )

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
