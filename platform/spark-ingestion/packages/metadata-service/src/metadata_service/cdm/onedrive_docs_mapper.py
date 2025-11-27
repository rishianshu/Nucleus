"""Pure helpers to convert normalized OneDrive payloads into the docs CDM."""

from datetime import datetime
from typing import Any, Dict, Optional

from runtime_core.cdm import (
    CdmDocItem,
    CdmDocLink,
    CdmDocRevision,
    CdmDocSpace,
)


def map_onedrive_drive_to_cdm(drive: Dict[str, Any], *, source_system: str = "onedrive") -> CdmDocSpace:
    drive_id = str(drive.get("id") or "")
    cdm_id = f"cdm:doc:space:{source_system}:{drive_id}"

    return CdmDocSpace(
        cdm_id=cdm_id,
        source_system=source_system,
        source_space_id=drive_id,
        key=drive.get("driveType") or drive.get("name"),
        name=str(drive.get("name") or drive_id),
        description=drive.get("description"),
        url=drive.get("webUrl"),
        properties={
            "driveType": drive.get("driveType"),
            "owner": drive.get("owner"),
            "raw": drive,
        },
    )


def map_onedrive_item_to_cdm(
    item: Dict[str, Any],
    *,
    space_cdm_id: str,
    parent_item_cdm_id: Optional[str],
    source_system: str = "onedrive",
) -> CdmDocItem:
    item_id = str(item.get("id") or "")
    drive_native_id = _extract_space_native_id(space_cdm_id)
    cdm_id = f"cdm:doc:item:{source_system}:{drive_native_id}:{item_id}"
    doc_type = "folder" if item.get("folder") else ("file" if item.get("file") else item.get("contentType"))
    mime_type = (item.get("file") or {}).get("mimeType")
    tags = _extract_tags(item)

    return CdmDocItem(
        cdm_id=cdm_id,
        source_system=source_system,
        source_item_id=item_id,
        space_cdm_id=space_cdm_id,
        parent_item_cdm_id=parent_item_cdm_id,
        title=str(item.get("name") or item_id),
        doc_type=doc_type,
        mime_type=mime_type,
        created_by_cdm_id=_user_cdm_id(_identity_user(item.get("createdBy")), source_system),
        updated_by_cdm_id=_user_cdm_id(_identity_user(item.get("lastModifiedBy")), source_system),
        created_at=_parse_datetime(item.get("createdDateTime")),
        updated_at=_parse_datetime(item.get("lastModifiedDateTime")),
        url=item.get("webUrl"),
        tags=tags,
        properties={
            "size": item.get("size"),
            "fileSystemInfo": item.get("fileSystemInfo"),
            "parentReference": item.get("parentReference"),
            "raw": item,
        },
    )


def map_onedrive_item_version_to_cdm(
    item: Dict[str, Any],
    version: Dict[str, Any],
    *,
    item_cdm_id: str,
    source_system: str = "onedrive",
) -> CdmDocRevision:
    version_id = str(version.get("id") or version.get("name") or "")
    item_id = str(item.get("id") or "")
    cdm_id = f"cdm:doc:revision:{source_system}:{item_id}:{version_id}"

    return CdmDocRevision(
        cdm_id=cdm_id,
        source_system=source_system,
        source_revision_id=version_id,
        item_cdm_id=item_cdm_id,
        revision_number=_safe_int(version.get("sequenceNumber") or version.get("versionNumber")),
        revision_label=version.get("label") or version.get("id"),
        author_cdm_id=_user_cdm_id(_identity_user(version.get("lastModifiedBy")), source_system),
        created_at=_parse_datetime(version.get("lastModifiedDateTime") or version.get("createdDateTime")),
        summary=version.get("published") or version.get("description"),
        properties={
            "size": version.get("size"),
            "contentType": version.get("contentType"),
            "raw": version,
        },
    )


def map_onedrive_link_to_cdm(
    link: Dict[str, Any],
    *,
    from_item_cdm_id: str,
    maybe_target_item_cdm_id: Optional[str],
    source_system: str = "onedrive",
) -> CdmDocLink:
    link_id = str(link.get("id") or link.get("shareId") or link.get("webUrl") or "")
    cdm_id = f"cdm:doc:link:{source_system}:{link_id}"

    return CdmDocLink(
        cdm_id=cdm_id,
        source_system=source_system,
        source_link_id=link_id,
        from_item_cdm_id=from_item_cdm_id,
        to_item_cdm_id=maybe_target_item_cdm_id,
        url=link.get("webUrl"),
        link_type=link.get("type") or (link.get("link") or {}).get("type"),
        created_at=_parse_datetime(link.get("createdDateTime")),
        properties={
            "scope": link.get("scope"),
            "shareId": link.get("shareId"),
            "grantedTo": link.get("grantedTo") or link.get("grantedToIdentities"),
            "raw": link,
        },
    )


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_space_native_id(space_cdm_id: str) -> str:
    if not space_cdm_id:
        return ""
    parts = space_cdm_id.split(":")
    return parts[-1] if parts else ""


def _identity_user(identity: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(identity, dict):
        return None
    if "user" in identity and isinstance(identity["user"], dict):
        return identity["user"]
    if "application" in identity and isinstance(identity["application"], dict):
        return identity["application"]
    return identity


def _user_cdm_id(user: Optional[Dict[str, Any]], source_system: str) -> Optional[str]:
    if not isinstance(user, dict):
        return None
    user_id = user.get("id") or user.get("userId")
    if not user_id:
        return None
    return f"cdm:identity:user:{source_system}:{user_id}"


def _extract_tags(item: Dict[str, Any]) -> list:
    candidates = item.get("tags") or item.get("categories")
    if isinstance(candidates, list):
        return [str(tag) for tag in candidates if isinstance(tag, (str, int))]
    return []


def _safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
