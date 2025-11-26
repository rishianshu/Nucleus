from __future__ import annotations

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


class JiraMetadataNormalizer(MetadataNormalizer):
    """Normalize Jira metadata manifests into CatalogSnapshot models."""

    def normalize(
        self,
        *,
        raw: Dict[str, object],
        environment: Dict[str, object],
        config: Dict[str, object],
        endpoint_descriptor: Dict[str, object],
    ) -> CatalogSnapshot:
        datasource = self._build_datasource(raw.get("datasource") or {}, endpoint_descriptor)
        dataset_cfg = raw.get("dataset") or {}
        dataset = self._build_dataset(dataset_cfg, datasource)
        schema_fields = self._build_schema_fields(dataset_cfg.get("fields") or [])
        statistics = self._build_statistics(dataset_cfg.get("statistics"))
        constraints = self._build_constraints(dataset_cfg.get("constraints") or [])

        snapshot = CatalogSnapshot(
            source="jira",
            schema=dataset_cfg.get("schema") or "jira",
            name=dataset.name or dataset.id or "jira_dataset",
            data_source=datasource,
            dataset=dataset,
            environment=environment,
            schema_fields=schema_fields,
            statistics=statistics,
            constraints=constraints,
            raw_vendor={"dataset": dataset_cfg, "datasource": raw.get("datasource"), "config": config},
            extras={"endpoint": endpoint_descriptor},
        )
        return snapshot

    # ------------------------------------------------------------------ helpers --
    def _build_datasource(self, cfg: Dict[str, Any], descriptor: Dict[str, Any]) -> DataSourceMetadata:
        properties = dict(cfg.get("properties") or {})
        if descriptor.get("base_url"):
            properties.setdefault("baseUrl", descriptor["base_url"])
        return DataSourceMetadata(
            id=cfg.get("id") or descriptor.get("source_id"),
            name=cfg.get("name") or descriptor.get("title") or "Jira",
            type="jira",
            system=descriptor.get("base_url"),
            version=cfg.get("version"),
            description=cfg.get("description"),
            tags=list(cfg.get("tags") or []),
            properties=properties,
            extras=dict(cfg.get("extras") or {}),
        )

    def _build_dataset(self, cfg: Dict[str, Any], datasource: DataSourceMetadata) -> DatasetMetadata:
        return DatasetMetadata(
            id=cfg.get("id"),
            name=cfg.get("name") or cfg.get("entity") or "jira_dataset",
            physical_name=cfg.get("physical_name"),
            type=cfg.get("type") or "semantic",
            source_id=datasource.id or datasource.name,
            location=cfg.get("location"),
            description=cfg.get("description"),
            tags=list(cfg.get("tags") or []),
            properties=dict(cfg.get("properties") or {}),
            extras=dict(cfg.get("extras") or {}),
        )

    def _build_schema_fields(self, fields: List[Dict[str, Any]]) -> List[SchemaField]:
        schema_fields: List[SchemaField] = []
        for position, field in enumerate(fields, start=1):
            schema_fields.append(
                SchemaField(
                    name=str(field.get("name") or f"field_{position}"),
                    data_type=str(field.get("data_type") or "STRING"),
                    precision=_optional_int(field.get("precision")),
                    scale=_optional_int(field.get("scale")),
                    length=_optional_int(field.get("length")),
                    nullable=bool(field.get("nullable", True)),
                    default=field.get("default"),
                    comment=field.get("comment"),
                    position=field.get("position") or position,
                    statistics=self._build_field_stats(field.get("statistics")),
                    extras=dict(field.get("extras") or {}),
                )
            )
        return schema_fields

    def _build_field_stats(self, stats: Optional[Dict[str, Any]]) -> Optional[SchemaFieldStatistics]:
        if not stats:
            return None
        return SchemaFieldStatistics(
            distinct_count=_optional_int(stats.get("distinct_count")),
            null_count=_optional_int(stats.get("null_count")),
            density=_optional_float(stats.get("density")),
            average_length=_optional_float(stats.get("average_length")),
            histogram=stats.get("histogram"),
            last_analyzed=stats.get("last_analyzed"),
            min_value=stats.get("min_value"),
            max_value=stats.get("max_value"),
            extras=dict(stats.get("extras") or {}),
        )

    def _build_statistics(self, stats: Optional[Dict[str, Any]]) -> Optional[DatasetStatistics]:
        if not stats:
            return None
        return DatasetStatistics(
            record_count=_optional_int(stats.get("record_count")),
            storage_blocks=_optional_int(stats.get("storage_blocks")),
            average_record_size=_optional_int(stats.get("average_record_size")),
            sample_size=_optional_int(stats.get("sample_size")),
            last_profiled_at=stats.get("last_profiled_at"),
            extras=dict(stats.get("extras") or {}),
        )

    def _build_constraints(self, constraints: List[Dict[str, Any]]) -> List[DatasetConstraint]:
        normalized: List[DatasetConstraint] = []
        for constraint in constraints:
            fields = [
                DatasetConstraintField(field=str(entry.get("field")), position=_optional_int(entry.get("position")))
                for entry in constraint.get("fields", [])
                if entry.get("field")
            ]
            normalized.append(
                DatasetConstraint(
                    name=str(constraint.get("name") or constraint.get("constraint_name") or "jira_constraint"),
                    constraint_type=str(constraint.get("type") or constraint.get("constraint_type") or "semantic"),
                    status=constraint.get("status"),
                    deferrable=constraint.get("deferrable"),
                    deferred=constraint.get("deferred"),
                    delete_rule=constraint.get("delete_rule"),
                    referenced_constraint=constraint.get("referenced_constraint"),
                    fields=fields,
                    extras=dict(constraint.get("extras") or {}),
                )
            )
        return normalized


def _optional_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


__all__ = ["JiraMetadataNormalizer"]
