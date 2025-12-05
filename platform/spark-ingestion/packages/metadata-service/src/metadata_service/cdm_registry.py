from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from endpoint_service.endpoints.jira import jira_work_mapper
from endpoint_service.endpoints.confluence import confluence_docs_mapper
from ingestion_models.cdm.docs import CDM_DOC_ITEM, CDM_DOC_LINK, CDM_DOC_REVISION, CDM_DOC_SPACE


# Registry maps (family, unit_id, cdm_model_id) -> mapper callable
Mapper = Callable[[Dict[str, Any]], Optional[Any]]


class CdmRegistry:
    def __init__(self) -> None:
        self._mappers: Dict[Tuple[str, str, str], Mapper] = {}

    def register(self, family: str, unit_id: str, cdm_model_id: str, mapper: Mapper) -> None:
        key = (family, unit_id, cdm_model_id)
        self._mappers[key] = mapper

    def resolve(self, family: str, unit_id: str, cdm_model_id: str) -> Optional[Mapper]:
        return self._mappers.get((family, unit_id, cdm_model_id))

    def supported_models(self, family: str, unit_id: str) -> List[str]:
        return [cdm for (fam, uid, cdm) in self._mappers.keys() if fam == family and uid == unit_id]


registry = CdmRegistry()


def infer_family(template_id: Optional[str], unit_id: str) -> str:
    if template_id and "." in template_id:
        return template_id.split(".", 1)[0]
    if unit_id and "." in unit_id:
        return unit_id.split(".", 1)[0]
    return "unknown"


def register_default_mappers() -> None:
    # Jira Work
    registry.register("jira", "jira.projects", "cdm.work.project", lambda p: jira_work_mapper.map_jira_project_to_cdm(p))
    registry.register("jira", "jira.users", "cdm.work.user", lambda p: jira_work_mapper.map_jira_user_to_cdm(p))
    registry.register(
        "jira",
        "jira.issues",
        "cdm.work.item",
        lambda p: jira_work_mapper.map_jira_issue_to_cdm(p, project_cdm_id=_extract_project_cdm(p)),
    )
    registry.register(
        "jira",
        "jira.comments",
        "cdm.work.comment",
        lambda p: jira_work_mapper.map_jira_comment_to_cdm(p, item_cdm_id=_extract_item_cdm(p)),
    )
    registry.register(
        "jira",
        "jira.worklogs",
        "cdm.work.worklog",
        lambda p: jira_work_mapper.map_jira_worklog_to_cdm(p, item_cdm_id=_extract_item_cdm(p)),
    )

    # Confluence Docs
    registry.register("confluence", "confluence.space", CDM_DOC_SPACE, lambda p: confluence_docs_mapper.map_confluence_space_to_cdm(p))
    registry.register("confluence", "confluence.page", CDM_DOC_ITEM, _map_confluence_page_to_item)
    registry.register("confluence", "confluence.page.version", CDM_DOC_REVISION, _map_confluence_page_to_revision)
    registry.register("confluence", "confluence.attachment", CDM_DOC_LINK, _map_attachment_to_link)


def apply_cdm(
    family: str,
    unit_id: str,
    cdm_model_id: Optional[str],
    records: List[Dict[str, Any]],
    *,
    dataset_id: Optional[str] = None,
    endpoint_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    if not cdm_model_id:
        return records
    mapped: List[Dict[str, Any]] = []
    for record in records:
        payload = record.get("payload") if isinstance(record, dict) else record
        if not isinstance(payload, dict):
            mapped.append(record)
            continue
        mapper = registry.resolve(family, unit_id, cdm_model_id)
        if mapper is None:
            mapped.append(record)
            continue
        mapped_payload = mapper(_select_source_payload(unit_id, payload))
        if mapped_payload is None:
            continue
        mapped.append(_wrap_cdm_record(record, mapped_payload, cdm_model_id, dataset_id=dataset_id, endpoint_id=endpoint_id))
    return mapped


def _wrap_cdm_record(
    record: Dict[str, Any],
    cdm_obj: Any,
    model_id: str,
    *,
    dataset_id: Optional[str] = None,
    endpoint_id: Optional[str] = None,
) -> Dict[str, Any]:
    serialized = _serialize_cdm_record(cdm_obj)
    _attach_cdm_source_metadata(serialized, dataset_id=dataset_id, endpoint_id=endpoint_id)
    new_record = dict(record)
    new_record["entityType"] = model_id
    new_record["cdmModelId"] = model_id
    new_record["payload"] = serialized
    logical_id = serialized.get("cdm_id")
    if logical_id:
        new_record["logicalId"] = logical_id
    display_name = serialized.get("name") or serialized.get("title")
    if display_name:
        new_record["displayName"] = display_name
    return new_record


def _serialize_cdm_record(record_obj: Any) -> Dict[str, Any]:
    if hasattr(record_obj, "__dict__"):
        return record_obj.__dict__
    if hasattr(record_obj, "_asdict"):
        return record_obj._asdict()
    if isinstance(record_obj, dict):
        return record_obj
    return dict(record_obj)


# Jira helpers
def _extract_project_cdm(payload: Dict[str, Any]) -> str:
    project = payload.get("project") or payload.get("projectKey") or payload.get("project_key")
    if not project and isinstance(payload.get("fields"), dict):
        project = payload["fields"].get("project")
    key = ""
    if isinstance(project, dict):
        key = project.get("key") or ""
    elif isinstance(project, str):
        key = project
    return f"cdm:work:project:jira:{str(key).upper()}"


def _extract_item_cdm(payload: Dict[str, Any]) -> str:
    issue = payload.get("issue") or payload.get("issueKey") or payload.get("issue_key")
    key = ""
    if isinstance(issue, dict):
        key = issue.get("key") or ""
    elif isinstance(issue, str):
        key = issue
    return f"cdm:work:item:jira:{str(key)}"


# Confluence helpers
def _map_confluence_page_to_item(payload: Dict[str, Any]):
    space = payload.get("space") or payload.get("spaceKey") or payload.get("spaceId")
    space_cdm_id = None
    if isinstance(space, dict) and space.get("key"):
        space_cdm_id = f"cdm:doc:space:confluence:{space.get('key')}"
    elif isinstance(space, str):
        space_cdm_id = f"cdm:doc:space:confluence:{space}"
    resolved_space_id = space_cdm_id or ""
    return confluence_docs_mapper.map_confluence_page_to_cdm(payload, space_cdm_id=resolved_space_id, parent_item_cdm_id=None)


def _map_confluence_page_to_revision(payload: Dict[str, Any]):
    version = payload.get("version")
    if not isinstance(version, dict) or not version:
        return None
    doc_item_id = payload.get("id")
    if not doc_item_id:
        return None
    item_cdm_id = f"cdm:doc:item:confluence:{doc_item_id}"
    return confluence_docs_mapper.map_confluence_page_version_to_cdm(payload, version, item_cdm_id=item_cdm_id)


def _map_attachment_to_link(payload: Dict[str, Any]):
    container = payload.get("container") or {}
    container_id = container.get("id") or (container.get("content") or {}).get("id")
    if not container_id:
        return None
    from_item_cdm_id = f"cdm:doc:item:confluence:{container_id}"
    link_payload = {
        "id": payload.get("id"),
        "url": payload.get("downloadLink"),
        "type": "attachment",
        "linkType": payload.get("mediaType") or "attachment",
        "title": payload.get("title"),
        "created_at": payload.get("createdAt"),
    }
    return confluence_docs_mapper.map_confluence_link_to_cdm(link_payload, from_item_cdm_id=from_item_cdm_id, maybe_target_item_cdm_id=None)


def _select_source_payload(unit_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    raw_payload = payload.get("raw")
    if isinstance(raw_payload, dict):
        enriched = dict(raw_payload)
        issue_key = payload.get("issueKey")
        if issue_key and not enriched.get("issueKey"):
            enriched["issueKey"] = issue_key
        if unit_id == "jira.issues":
            fields = enriched.get("fields")
            if not isinstance(fields, dict):
                enriched["fields"] = payload.get("fields") or raw_payload.get("fields") or {}
        return enriched
    return payload


def _attach_cdm_source_metadata(payload: Dict[str, Any], *, dataset_id: Optional[str], endpoint_id: Optional[str]) -> None:
    properties = payload.get("properties") or {}
    if not isinstance(properties, dict):
        properties = {}
    metadata_block = properties.get("_metadata") or {}
    if not isinstance(metadata_block, dict):
        metadata_block = {}
    if dataset_id and "sourceDatasetId" not in metadata_block:
        metadata_block["sourceDatasetId"] = dataset_id
    if endpoint_id and "sourceEndpointId" not in metadata_block:
        metadata_block["sourceEndpointId"] = endpoint_id
    if metadata_block:
        properties["_metadata"] = metadata_block
    payload["properties"] = properties


register_default_mappers()
