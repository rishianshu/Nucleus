from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from ingestion_models.cdm.docs import CdmDocItem, CdmDocLink, CdmDocRevision, CdmDocSpace


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None


def map_onedrive_item_to_cdm(item: Dict[str, Any], *, drive_id: str, source_system: str = "onedrive") -> CdmDocItem:
    """Map a OneDrive file item to cdm.doc.item payload."""
    item_id = str(item.get("id") or "")
    logical_id = f"cdm:doc:item:{source_system}:{drive_id}:{item_id}"
    mime_type = (item.get("file") or {}).get("mimeType")
    size = item.get("size")
    last_modified = _parse_ts(item.get("lastModifiedDateTime"))
    web_url = item.get("webUrl")
    name = item.get("name") or item_id
    path = item.get("path") or name
    raw_source = {
        "id": item_id,
        "driveId": drive_id,
        "name": name,
        "size": size,
        "mimeType": mime_type,
        "webUrl": web_url,
        "createdDateTime": item.get("createdDateTime"),
        "lastModifiedDateTime": item.get("lastModifiedDateTime"),
    }
    return CdmDocItem(
        cdm_id=logical_id,
        source_system=source_system,
        source_id=item_id,
        source_item_id=item_id,
        space_cdm_id=f"cdm:doc:space:{source_system}:{drive_id}",
        parent_item_cdm_id=None,
        title=name,
        doc_type=item.get("file", {}).get("mimeType") or "file",
        mime_type=mime_type or "application/octet-stream",
        source_url=web_url or path,
        created_by_cdm_id=None,
        updated_by_cdm_id=None,
        created_at=None,
        updated_at=last_modified,
        url=web_url or path,
        tags=[],
        raw_source=raw_source,
        properties={
            "path": path,
            "mimeType": mime_type,
            "size": size,
            "webUrl": web_url,
            "raw": item,
        },
    )


def map_onedrive_drive_to_cdm(drive: Dict[str, Any], *, source_system: str = "onedrive") -> CdmDocSpace:
    drive_id = str(drive.get("id") or "")
    logical_id = f"cdm:doc:space:{source_system}:{drive_id}"
    return CdmDocSpace(
        cdm_id=logical_id,
        source_system=source_system,
        source_space_id=drive_id,
        key=drive.get("name") or drive_id,
        name=drive.get("name") or drive_id,
        description=drive.get("description"),
        url=drive.get("webUrl"),
        properties={"driveType": drive.get("driveType"), "raw": drive},
    )


def map_onedrive_item_version_to_cdm(item: Dict[str, Any], version: Dict[str, Any], *, drive_id: str, source_system: str = "onedrive") -> CdmDocRevision:
    item_id = str(item.get("id") or "")
    version_id = str(version.get("id") or "")
    logical_id = f"cdm:doc:revision:{source_system}:{drive_id}:{item_id}:{version_id}"
    return CdmDocRevision(
        cdm_id=logical_id,
        source_system=source_system,
        source_revision_id=version_id,
        item_cdm_id=f"cdm:doc:item:{source_system}:{drive_id}:{item_id}",
        revision_number=None,
        revision_label=version.get("lastModifiedDateTime") or version_id,
        author_cdm_id=None,
        created_at=_parse_ts(version.get("lastModifiedDateTime")),
        summary=None,
        properties={"size": version.get("size"), "raw": version},
    )


def map_onedrive_link_to_cdm(item: Dict[str, Any], link: Dict[str, Any], *, drive_id: str, source_system: str = "onedrive") -> CdmDocLink:
    item_id = str(item.get("id") or "")
    url = (link.get("link") or {}).get("webUrl") or link.get("webUrl")
    logical_id = f"cdm:doc:link:{source_system}:{drive_id}:{item_id}"
    return CdmDocLink(
        cdm_id=logical_id,
        source_system=source_system,
        source_link_id=str(link.get("id") or logical_id),
        from_item_cdm_id=f"cdm:doc:item:{source_system}:{drive_id}:{item_id}",
        to_item_cdm_id=None,
        url=url,
        link_type=(link.get("link") or {}).get("type") or link.get("scope") or link.get("type"),
        created_at=_parse_ts(link.get("createdDateTime") or link.get("lastModifiedDateTime")),
        properties={"visibility": link.get("scope") or link.get("type"), "raw": link},
    )


__all__ = [
    "map_onedrive_item_to_cdm",
    "map_onedrive_drive_to_cdm",
    "map_onedrive_item_version_to_cdm",
    "map_onedrive_link_to_cdm",
]
