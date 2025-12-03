"""Pure helpers to convert normalized Confluence payloads into the docs CDM."""

from datetime import datetime
from typing import Any, Dict, Optional

from ingestion_models.cdm import (
    CdmDocItem,
    CdmDocLink,
    CdmDocRevision,
    CdmDocSpace,
)


def map_confluence_space_to_cdm(space: Dict[str, Any], *, source_system: str = "confluence") -> CdmDocSpace:
    native_id = str(space.get("id") or space.get("key") or "")
    cdm_id = f"cdm:doc:space:{source_system}:{native_id}"
    description = _extract_description(space)
    url = space.get("url") or _link(space, "webui")

    return CdmDocSpace(
        cdm_id=cdm_id,
        source_system=source_system,
        source_space_id=native_id,
        key=space.get("key"),
        name=str(space.get("name") or space.get("key") or native_id),
        description=description,
        url=url,
        properties={
            "status": space.get("status"),
            "type": space.get("type"),
            "raw": space,
        },
    )


def map_confluence_page_to_cdm(
    page: Dict[str, Any],
    *,
    space_cdm_id: str,
    parent_item_cdm_id: Optional[str],
    source_system: str = "confluence",
) -> CdmDocItem:
    native_id = str(page.get("id") or page.get("contentId") or page.get("pageId") or "")
    cdm_id = f"cdm:doc:item:{source_system}:{native_id}"
    history = page.get("history") or {}
    version = page.get("version") or {}
    labels = _labels(page)

    return CdmDocItem(
        cdm_id=cdm_id,
        source_system=source_system,
        source_item_id=native_id,
        space_cdm_id=space_cdm_id,
        parent_item_cdm_id=parent_item_cdm_id,
        title=str(page.get("title") or native_id),
        doc_type=page.get("type"),
        mime_type=page.get("body", {}).get("storage", {}).get("representation"),
        created_by_cdm_id=_user_cdm_id(history.get("createdBy"), source_system),
        updated_by_cdm_id=_user_cdm_id(version.get("by"), source_system),
        created_at=_parse_datetime(
            page.get("created_at") or history.get("createdDate") or version.get("when")
        ),
        updated_at=_parse_datetime(page.get("updated_at") or version.get("when")),
        url=page.get("url") or _link(page, "tinyui") or _link(page, "webui"),
        tags=labels,
        properties={
            "spaceKey": history.get("spaceKey") or page.get("spaceKey"),
            "status": page.get("status"),
            "labels": labels,
            "metadata": page.get("metadata"),
            "raw": page,
        },
    )


def map_confluence_page_version_to_cdm(
    page: Dict[str, Any],
    version: Dict[str, Any],
    *,
    item_cdm_id: str,
    source_system: str = "confluence",
) -> CdmDocRevision:
    native_id = str(version.get("id") or version.get("number") or "")
    page_native = str(page.get("id") or page.get("contentId") or "")
    cdm_id = f"cdm:doc:revision:{source_system}:{page_native}:{native_id}"

    return CdmDocRevision(
        cdm_id=cdm_id,
        source_system=source_system,
        source_revision_id=native_id,
        item_cdm_id=item_cdm_id,
        revision_number=_safe_int(version.get("number")),
        revision_label=version.get("friendlyWhen") or version.get("message"),
        author_cdm_id=_user_cdm_id(version.get("by"), source_system),
        created_at=_parse_datetime(version.get("when")),
        summary=version.get("message"),
        properties={
            "minorEdit": version.get("minorEdit"),
            "syncRev": version.get("syncRev"),
            "raw": version,
        },
    )


def map_confluence_link_to_cdm(
    link: Dict[str, Any],
    *,
    from_item_cdm_id: str,
    maybe_target_item_cdm_id: Optional[str],
    source_system: str = "confluence",
) -> CdmDocLink:
    native_id = str(link.get("id") or link.get("globalId") or link.get("url") or "")
    cdm_id = f"cdm:doc:link:{source_system}:{native_id}"

    return CdmDocLink(
        cdm_id=cdm_id,
        source_system=source_system,
        source_link_id=native_id,
        from_item_cdm_id=from_item_cdm_id,
        to_item_cdm_id=maybe_target_item_cdm_id,
        url=link.get("url"),
        link_type=link.get("type") or link.get("linkType"),
        created_at=_parse_datetime(link.get("created_at") or link.get("createdAt")),
        properties={
            "title": link.get("title"),
            "anchor": link.get("anchor"),
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


def _labels(page: Dict[str, Any]) -> list:
    labels = page.get("labels")
    if isinstance(labels, list):
        result = []
        for label in labels:
            if isinstance(label, str):
                result.append(label)
            elif isinstance(label, dict) and label.get("name"):
                result.append(str(label.get("name")))
        return result
    return []


def _link(obj: Dict[str, Any], key: str) -> Optional[str]:
    links = obj.get("_links")
    if isinstance(links, dict):
        value = links.get(key)
        if isinstance(value, str):
            base = links.get("base")
            if base and value.startswith("/"):
                return f"{base}{value}"
            return value
    return None


def _extract_description(space: Dict[str, Any]) -> Optional[str]:
    description = space.get("description")
    if isinstance(description, str):
        return description
    if isinstance(description, dict):
        plain = description.get("plain")
        if isinstance(plain, dict):
            value = plain.get("value")
            if isinstance(value, str):
                return value
    return None


def _user_cdm_id(user: Optional[Dict[str, Any]], source_system: str) -> Optional[str]:
    if not isinstance(user, dict):
        return None
    user_id = user.get("accountId") or user.get("userId") or user.get("id")
    if not user_id:
        return None
    return f"cdm:work:user:{source_system}:{user_id}"


def _safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
