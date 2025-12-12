from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from ingestion_models.metadata import CatalogSnapshot, DataSourceMetadata, DatasetMetadata, SchemaField
from ingestion_models.metadata.normalizers.base import MetadataNormalizer
from endpoint_service.endpoints.onedrive.onedrive_catalog import ONEDRIVE_DATASET_DEFINITIONS, DEFAULT_ONEDRIVE_DATASET
from endpoint_service.endpoints.onedrive.onedrive_docs_mapper import map_onedrive_drive_to_cdm, map_onedrive_item_to_cdm


class OneDriveMetadataNormalizer(MetadataNormalizer):
    """Normalize OneDrive manifests into CatalogSnapshot models."""

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
        files = raw.get("files") or []
        datasource = self._build_datasource(datasource_cfg, endpoint_descriptor)
        dataset = self._build_dataset(dataset_cfg, datasource)
        fields = self._build_schema_fields(dataset_cfg.get("fields") or [])
        mapped_drive = map_onedrive_drive_to_cdm(environment.get("drive", {}) or {"id": datasource_cfg.get("drive_id")})
        mapped_items = [map_onedrive_item_to_cdm(item, drive_id=datasource_cfg.get("drive_id") or "") for item in files]

        snapshot = CatalogSnapshot(
            source="onedrive",
            schema=dataset_cfg.get("schema") or "onedrive",
            table=dataset_cfg.get("table") or dataset.name or dataset.id or DEFAULT_ONEDRIVE_DATASET,
            collected_at=datetime.now(timezone.utc).isoformat(),
            data_source=datasource,
            dataset=dataset,
            fields=fields,
            extras={
                "raw_vendor": {"dataset": dataset_cfg, "datasource": datasource_cfg, "config": config, "files": files},
                "preview": files[:5],
                "cdm": {"spaces": [mapped_drive], "items": mapped_items},
            },
        )
        snapshot.schema_fields = fields
        return snapshot

    def _build_datasource(self, cfg: Dict[str, Any], descriptor: Dict[str, Any]) -> DataSourceMetadata:
        properties = dict(cfg.get("properties") or {})
        base_url = descriptor.get("base_url") or properties.get("baseUrl")
        if base_url:
            properties.setdefault("baseUrl", base_url)
        return DataSourceMetadata(
            id=cfg.get("id") or descriptor.get("source_id"),
            name=cfg.get("name") or descriptor.get("title") or "OneDrive",
            type="onedrive",
            system=base_url,
            version=cfg.get("version"),
            description=cfg.get("description"),
            tags=list(cfg.get("tags") or []),
            properties=properties,
            extras=dict(cfg.get("extras") or {}),
        )

    def _build_dataset(self, cfg: Dict[str, Any], datasource: DataSourceMetadata) -> DatasetMetadata:
        return DatasetMetadata(
            id=cfg.get("id") or DEFAULT_ONEDRIVE_DATASET,
            name=cfg.get("name") or cfg.get("entity") or DEFAULT_ONEDRIVE_DATASET,
            physical_name=cfg.get("physical_name") or cfg.get("table"),
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
        if not fields:
            fields = ONEDRIVE_DATASET_DEFINITIONS[DEFAULT_ONEDRIVE_DATASET].get("fields") or []
        for position, field in enumerate(fields, start=1):
            normalized.append(
                SchemaField(
                    name=str(field.get("name") or f"field_{position}"),
                    data_type=str(field.get("data_type") or field.get("dataType") or "STRING"),
                    precision=None,
                    scale=None,
                    length=None,
                    nullable=bool(field.get("nullable", True)),
                    default=field.get("default"),
                    comment=field.get("comment"),
                    position=field.get("position") or position,
                    extras=dict(field.get("extras") or {}),
                )
            )
        return normalized


__all__ = ["OneDriveMetadataNormalizer"]
