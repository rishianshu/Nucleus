from __future__ import annotations

from typing import Any, Dict, List

from ingestion_models.cdm.docs import CDM_DOC_ITEM

DEFAULT_ONEDRIVE_DATASET = "onedrive.docs"
DEFAULT_CURSOR_FIELD = "lastModifiedDateTime"

ONEDRIVE_DATASET_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    DEFAULT_ONEDRIVE_DATASET: {
        "name": "OneDrive Documents",
        "description": "Documents and files under the configured OneDrive drive/root path.",
        "ingestion": {
            "unit_id": DEFAULT_ONEDRIVE_DATASET,
            "display_name": "Documents",
            "supports_incremental": True,
            "incremental_column": DEFAULT_CURSOR_FIELD,
            "incremental_literal": "timestamp",
            "ingestion_strategy": "onedrive-lastmodified",
            "default_policy": {"cursor": DEFAULT_CURSOR_FIELD},
            "cdm_model_id": CDM_DOC_ITEM,
        },
        "fields": [
            {"name": "id", "data_type": "STRING", "nullable": False},
            {"name": "name", "data_type": "STRING", "nullable": False},
            {"name": "path", "data_type": "STRING", "nullable": False},
            {"name": "mimeType", "data_type": "STRING", "nullable": True},
            {"name": "size", "data_type": "LONG", "nullable": True},
            {"name": DEFAULT_CURSOR_FIELD, "data_type": "TIMESTAMP", "nullable": True},
        ],
    },
}

ONEDRIVE_API_LIBRARY: Dict[str, Dict[str, str]] = {
    "drive_detail": {
        "method": "GET",
        "path": "/drives/{drive-id}",
        "description": "Fetch drive metadata including name and driveType.",
        "docs": "https://learn.microsoft.com/graph/api/drive-get",
        "scope": "drive",
    },
    "root_children": {
        "method": "GET",
        "path": "/drives/{drive-id}/root/children",
        "description": "List items under the drive root.",
        "docs": "https://learn.microsoft.com/graph/api/driveitem-list-children",
        "scope": "items",
    },
    "item_children": {
        "method": "GET",
        "path": "/drives/{drive-id}/items/{item-id}/children",
        "description": "List items under a specific folder.",
        "docs": "https://learn.microsoft.com/graph/api/driveitem-list-children",
        "scope": "items",
    },
    "item_detail": {
        "method": "GET",
        "path": "/drives/{drive-id}/items/{item-id}",
        "description": "Retrieve metadata for a single DriveItem (file or folder).",
        "docs": "https://learn.microsoft.com/graph/api/driveitem-get",
        "scope": "items",
    },
    "item_versions": {
        "method": "GET",
        "path": "/drives/{drive-id}/items/{item-id}/versions",
        "description": "List versions for a DriveItem.",
        "docs": "https://learn.microsoft.com/graph/api/driveitem-list-versions",
        "scope": "versions",
    },
    "delta": {
        "method": "GET",
        "path": "/drives/{drive-id}/root/delta",
        "description": "Track incremental changes (files added, changed, or deleted) under the drive root.",
        "docs": "https://learn.microsoft.com/graph/api/driveitem-delta",
        "scope": "delta",
    },
}


def build_static_dataset_overview() -> List[Dict[str, Any]]:
    datasets: List[Dict[str, Any]] = []
    for dataset_id, definition in ONEDRIVE_DATASET_DEFINITIONS.items():
        datasets.append(
            {
                "datasetId": dataset_id,
                "name": definition.get("name") or dataset_id,
                "description": definition.get("description"),
                "fields": definition.get("fields", []),
                "ingestion": definition.get("ingestion") or {},
            }
        )
    return datasets


def build_static_unit_overview() -> List[Dict[str, Any]]:
    units: List[Dict[str, Any]] = []
    for dataset_id, definition in ONEDRIVE_DATASET_DEFINITIONS.items():
        ingestion_meta = definition.get("ingestion") or {}
        unit_id = ingestion_meta.get("unit_id") or dataset_id
        units.append(
            {
                "unitId": unit_id,
                "datasetId": dataset_id,
                "kind": "dataset",
                "displayName": ingestion_meta.get("display_name") or definition.get("name") or unit_id,
                "description": ingestion_meta.get("description") or definition.get("description"),
                "supportsIncremental": bool(ingestion_meta.get("supports_incremental", True)),
                "defaultPolicy": ingestion_meta.get("default_policy"),
                "cdmModelId": ingestion_meta.get("cdm_model_id"),
            }
        )
    return units


def build_static_api_overview() -> List[Dict[str, Any]]:
    return [
        {
            "key": key,
            "method": entry.get("method"),
            "path": entry.get("path"),
            "description": entry.get("description"),
            "docUrl": entry.get("docs"),
            "scope": entry.get("scope"),
        }
        for key, entry in ONEDRIVE_API_LIBRARY.items()
    ]


__all__ = [
    "DEFAULT_ONEDRIVE_DATASET",
    "DEFAULT_CURSOR_FIELD",
    "ONEDRIVE_DATASET_DEFINITIONS",
    "ONEDRIVE_API_LIBRARY",
    "build_static_dataset_overview",
    "build_static_unit_overview",
    "build_static_api_overview",
]
