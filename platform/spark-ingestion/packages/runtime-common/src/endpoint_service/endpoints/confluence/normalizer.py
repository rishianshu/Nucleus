from __future__ import annotations

from typing import Any, Dict, List, Optional

from datetime import datetime, timezone

from ingestion_models.metadata import CatalogSnapshot, DataSourceMetadata, DatasetMetadata, DatasetStatistics, SchemaField
from ingestion_models.metadata.normalizers.base import MetadataNormalizer


class ConfluenceMetadataNormalizer(MetadataNormalizer):
    """Normalize Confluence dataset manifests into CatalogSnapshot models."""

    def normalize(
        self,
        *,
        raw: Dict[str, Any],
        environment: Dict[str, Any],
        config: Dict[str, Any],
        endpoint_descriptor: Dict[str, Any],
    ) -> CatalogSnapshot:
        datasource_cfg = raw.get("datasource") or {}
        dataset_cfg = raw.get("dataset") or {}
        datasource = self._build_datasource(datasource_cfg, endpoint_descriptor)
        dataset = self._build_dataset(dataset_cfg, datasource)
        schema_fields = self._build_schema_fields(dataset_cfg.get("fields") or [])
        statistics = self._build_statistics(dataset_cfg.get("statistics"))
        snapshot = CatalogSnapshot(
            source="confluence",
            schema=dataset_cfg.get("schema") or "confluence",
            table=dataset_cfg.get("table") or dataset.name or dataset.id or "confluence_dataset",
            collected_at=datetime.now(timezone.utc).isoformat(),
            data_source=datasource,
            dataset=dataset,
            fields=schema_fields,
            statistics=statistics,
            extras={
                "endpoint": endpoint_descriptor,
                "raw_vendor": {"dataset": dataset_cfg, "datasource": datasource_cfg, "config": config},
            },
        )
        # backward compat for callers expecting schema_fields attribute
        snapshot.schema_fields = schema_fields
        return snapshot

    def _build_datasource(self, cfg: Dict[str, Any], descriptor: Dict[str, Any]) -> DataSourceMetadata:
        properties = dict(cfg.get("properties") or {})
        base_url = descriptor.get("base_url") or properties.get("baseUrl")
        if base_url:
            properties.setdefault("baseUrl", base_url)
        return DataSourceMetadata(
            id=cfg.get("id") or descriptor.get("source_id"),
            name=cfg.get("name") or descriptor.get("title") or "Confluence",
            type="confluence",
            system=base_url,
            version=cfg.get("version"),
            description=cfg.get("description"),
            tags=list(cfg.get("tags") or []),
            properties=properties,
            extras=dict(cfg.get("extras") or {}),
        )

    def _build_dataset(self, cfg: Dict[str, Any], datasource: DataSourceMetadata) -> DatasetMetadata:
        return DatasetMetadata(
            id=cfg.get("id"),
            name=cfg.get("name") or cfg.get("entity") or "confluence_dataset",
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
        normalized: List[SchemaField] = []
        for position, field in enumerate(fields, start=1):
            normalized.append(
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
                    extras=dict(field.get("extras") or {}),
                )
            )
        if not normalized:
            normalized = [
                SchemaField(name="spaceKey", data_type="STRING", nullable=False),
                SchemaField(name="name", data_type="STRING", nullable=False),
            ]
        return normalized

    def _build_statistics(self, stats: Optional[Dict[str, Any]]) -> Optional[DatasetStatistics]:
        if not stats:
            return None
        return DatasetStatistics(
            record_count=_optional_int(stats.get("record_count")),
            average_record_size=_optional_int(stats.get("average_record_size")),
            sample_size=_optional_int(stats.get("sample_size")),
            last_profiled_at=stats.get("last_profiled_at"),
            extras=dict(stats.get("extras") or {}),
        )


def _optional_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


__all__ = ["ConfluenceMetadataNormalizer"]
