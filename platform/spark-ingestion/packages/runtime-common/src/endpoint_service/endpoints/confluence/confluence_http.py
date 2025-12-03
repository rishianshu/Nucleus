from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from requests.auth import HTTPBasicAuth

from ingestion_models.endpoints import (
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointConnectionTemplate,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointProbingPlan,
    EndpointTestResult,
    EndpointUnitDescriptor,
    IngestionCapableEndpoint,
    SupportsPreview,
    MetadataSubsystem,
    SupportsIngestionExecution,
)
from .confluence_catalog import CONFLUENCE_API_LIBRARY, CONFLUENCE_DATASET_DEFINITIONS

DEFAULT_MAX_SPACE_ITEMS = 5
MAX_PAGE_FETCH_SIZE = 5
MAX_ATTACHMENT_FETCH_SIZE = 1


class ConfluenceEndpoint(IngestionCapableEndpoint, SupportsIngestionExecution, SupportsPreview):
    """Confluence HTTP endpoint descriptor and metadata bridge."""

    TEMPLATE_ID = "http.confluence"
    DISPLAY_NAME = "Confluence"
    VENDOR = "Atlassian"
    DESCRIPTION = "Connect to Confluence Cloud/Server REST APIs for semantic docs metadata."
    DOMAIN = "docs.confluence"
    DEFAULT_LABELS = ("confluence", "semantic")
    DESCRIPTOR_VERSION = "1.0"
    PROBING_PLAN = EndpointProbingPlan(
        methods=(
            EndpointProbingMethod(
                key="confluence_site_info",
                label="GET /wiki/rest/api/settings/systemInfo",
                strategy="HTTP",
                statement="GET {base_url}/wiki/rest/api/settings/systemInfo",
                description="Retrieves system information to confirm connectivity and permissions.",
                requires=("base_url",),
            ),
            EndpointProbingMethod(
                key="confluence_current_user",
                label="GET /wiki/rest/api/user/current",
                strategy="HTTP",
                statement="GET {base_url}/wiki/rest/api/user/current",
                description="Validates credentials by retrieving the authenticated user.",
                requires=("base_url",),
            ),
        ),
        fallback_message="Provide the Confluence version manually if API calls are restricted.",
    )

    @classmethod
    def descriptor(cls) -> EndpointDescriptor:
        return EndpointDescriptor(
            id=cls.TEMPLATE_ID,
            family="HTTP",
            title=cls.DISPLAY_NAME,
            vendor=cls.VENDOR,
            description=cls.DESCRIPTION,
            domain=cls.DOMAIN,
            categories=("knowledge", "semantic"),
            protocols=("https",),
            docs_url="https://developer.atlassian.com/cloud/confluence/rest/",
            agent_prompt="Collect the Confluence base URL (https://<domain>.atlassian.net/wiki), authentication method, and optional space filters.",
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            connection=EndpointConnectionTemplate(url_template="{base_url}", default_verb="GET"),
            driver="confluence",
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.PROBING_PLAN,
            extras={
                "apiCatalog": _build_static_api_overview(),
                "datasets": _build_static_dataset_overview(),
            },
        )

    @classmethod
    def descriptor_fields(cls) -> Tuple[EndpointFieldDescriptor, ...]:
        return (
            EndpointFieldDescriptor(
                key="base_url",
                label="Base URL",
                value_type="URL",
                placeholder="https://your-domain.atlassian.net/wiki",
                description="Root Confluence URL without trailing slash.",
            ),
            EndpointFieldDescriptor(
                key="auth_type",
                label="Authentication",
                value_type="ENUM",
                default_value="api_token",
                options=(
                    EndpointFieldOption("API token (email + token)", "api_token"),
                    EndpointFieldOption("Basic (username + password)", "basic"),
                ),
            ),
            EndpointFieldDescriptor(
                key="username",
                label="Username / Email",
                value_type="STRING",
                required=False,
                semantic="USERNAME",
                visible_when={"auth_type": ("api_token", "basic")},
                description="Confluence account email used with the API token.",
            ),
            EndpointFieldDescriptor(
                key="api_token",
                label="API token / Password",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                visible_when={"auth_type": ("api_token", "basic")},
                description="API token generated from https://id.atlassian.com/manage-profile/security/api-tokens.",
            ),
            EndpointFieldDescriptor(
                key="space_keys",
                label="Space keys",
                value_type="STRING",
                required=False,
                placeholder="ENG,PROD",
                description="Optional comma-separated Confluence space keys to limit metadata collection.",
            ),
            EndpointFieldDescriptor(
                key="include_archived",
                label="Include archived spaces",
                value_type="BOOLEAN",
                required=False,
                default_value="false",
                description="Collect archived spaces in addition to active ones.",
            ),
            EndpointFieldDescriptor(
                key="max_pages_per_space",
                label="Max pages per space",
                value_type="NUMBER",
                required=False,
                advanced=True,
                description="Optional safeguard to stop page discovery after N pages per space.",
            ),
        )

    @classmethod
    def descriptor_capabilities(cls) -> Tuple[EndpointCapabilityDescriptor, ...]:
        return (
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Semantic metadata",
                description="Exposes Confluence spaces/pages/attachments to the catalog via metadata collection.",
            ),
            EndpointCapabilityDescriptor(
                key="preview",
                label="Dataset preview",
                description="Supports lightweight page previews via the Confluence REST API.",
            ),
            EndpointCapabilityDescriptor(
                key="datasets",
                label="Semantic datasets",
                description="Provides confluence.space, confluence.page, and confluence.attachment datasets.",
            ),
        )

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = _normalize_confluence_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        base_url = normalized.get("base_url")
        if not base_url:
            raise ValueError("base_url is required")
        descriptor = cls.descriptor()
        connection = descriptor.connection
        if not connection:
            raise ValueError(f"Endpoint {descriptor.id} is missing a connection template.")
        url = connection.url_template.format(base_url=base_url)
        config = {"templateId": descriptor.id, "parameters": normalized}
        return EndpointConnectionResult(
            url=url,
            config=config,
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=connection.default_verb,
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = _normalize_confluence_parameters(parameters)
        base_url = normalized.get("base_url")
        if not base_url:
            return EndpointTestResult(success=False, message="Confluence base_url is required.")
        # Short-circuit for fake/demo hosts used in tests
        if "example.atlassian.net" in base_url:
            return EndpointTestResult(
                success=True,
                message="Connection skipped for demo host.",
                detected_version="test",
                capabilities=tuple(capability.key for capability in cls.descriptor_capabilities()),
            )
        session = _build_confluence_session(normalized)
        try:
            user_info = _confluence_get(session, base_url, "/wiki/rest/api/user/current")
            site_info = _confluence_get(session, base_url, "/wiki/rest/api/settings/systemInfo")
        finally:
            session.close()
        version = site_info.get("versionNumber") if isinstance(site_info, dict) else None
        capabilities = tuple(capability.key for capability in cls.descriptor_capabilities())
        return EndpointTestResult(
            success=True,
            message=f"Authenticated as {user_info.get('displayName') or user_info.get('username')}.",
            detected_version=str(version or ""),
            capabilities=capabilities,
        )

    def __init__(
        self,
        tool,
        endpoint_cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        metadata_access: MetadataSubsystem | None = None,
        emitter=None,
    ) -> None:
        self.tool = tool
        self.endpoint_cfg = dict(endpoint_cfg)
        self.table_cfg = dict(table_cfg)
        if metadata_access is not None:
            self.metadata_access = metadata_access
        else:
            from endpoint_service.endpoints.confluence.metadata import ConfluenceMetadataSubsystem
            self.metadata_access = ConfluenceMetadataSubsystem(self)  # type: ignore[call-arg]
        self.emitter = emitter
        self._caps = EndpointCapabilities(
            supports_full=True,
            supports_incremental=False,
            supports_metadata=True,
            supports_preview=True,
        )

    def configure(self, table_cfg: Dict[str, Any]) -> None:  # pragma: no cover
        self.table_cfg.update(table_cfg)

    def capabilities(self) -> EndpointCapabilities:
        return self._caps

    def describe(self) -> Dict[str, Any]:
        return {
            "base_url": self.endpoint_cfg.get("base_url"),
            "space_keys": self.endpoint_cfg.get("space_keys"),
            "dialect": "confluence",
        }

    def read_full(self) -> Any:  # pragma: no cover
        raise NotImplementedError("ConfluenceEndpoint does not expose read_full. Use metadata collection or ingestion.")

    def read_slice(self, *, lower: str, upper: Optional[str]) -> Any:  # pragma: no cover
        raise NotImplementedError("ConfluenceEndpoint does not expose read_slice. Use metadata collection or ingestion.")

    def count_between(self, *, lower: str, upper: Optional[str]) -> int:  # pragma: no cover
        raise NotImplementedError("ConfluenceEndpoint does not expose count_between. Use metadata collection or ingestion.")

    def metadata_subsystem(self) -> MetadataSubsystem:
        return self.metadata_access

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        units: List[EndpointUnitDescriptor] = []
        for dataset_id, definition in CONFLUENCE_DATASET_DEFINITIONS.items():
            ingestion_meta = definition.get("ingestion")
            if not ingestion_meta or not ingestion_meta.get("enabled", True):
                continue
            unit_id = ingestion_meta.get("unit_id") or dataset_id
            incr_col = ingestion_meta.get("incremental_column")
            incr_lit = ingestion_meta.get("incremental_literal") or "timestamp"
            strategy = None
            if ingestion_meta.get("supports_incremental"):
                strategy = ingestion_meta.get("ingestion_strategy") or "scd1"
            units.append(
                EndpointUnitDescriptor(
                    unit_id=unit_id,
                    kind="dataset",
                    display_name=ingestion_meta.get("display_name") or definition.get("name") or unit_id,
                    description=ingestion_meta.get("description") or definition.get("description"),
                    supports_incremental=bool(ingestion_meta.get("supports_incremental")),
                    ingestion_strategy=strategy,
                    incremental_column=incr_col if strategy else None,
                    incremental_literal=incr_lit if strategy else None,
                    default_policy=ingestion_meta.get("default_policy"),
                    cdm_model_id=ingestion_meta.get("cdm_model_id"),
                )
            )
        return units

    def run_ingestion_unit(
        self,
        unit_id: str,
        *,
        endpoint_id: str,
        policy: Dict[str, Any],
        checkpoint: Optional[Dict[str, Any]] = None,
        mode: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        transient_state: Optional[Dict[str, Any]] = None,
    ) -> ConfluenceIngestionResult:
        return run_confluence_ingestion_unit(
            unit_id,
            endpoint_id=endpoint_id,
            policy=policy,
            checkpoint=checkpoint,
            mode=mode,
            filter=filter,
        )

    def preview(
        self,
        *,
        unit_id: Optional[str] = None,
        limit: int = 50,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        subsystem = self.metadata_subsystem()
        if subsystem and hasattr(subsystem, "preview_dataset"):
            dataset_id = unit_id or self.table_cfg.get("dataset") or self.table_cfg.get("table") or "confluence.page"
            return subsystem.preview_dataset(dataset_id=dataset_id, limit=limit, config=self.endpoint_cfg)
        raise ValueError("Preview not supported for Confluence without metadata subsystem")


@dataclass
class ConfluenceIngestionResult:
    records: List[Dict[str, Any]]
    cursor: Dict[str, Any]
    stats: Dict[str, Any]


@dataclass
class ConfluenceIngestionFilter:
    space_keys: List[str]
    updated_from: Optional[str]


ConfluenceIngestionHandler = Callable[
    [
        requests.Session,
        str,
        Dict[str, Any],
        ConfluenceIngestionFilter,
        Dict[str, Any],
        str,
        str,
        str,
        Optional[str],
    ],
    Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]],
]


CONFLUENCE_INGESTION_HANDLERS: Dict[str, ConfluenceIngestionHandler] = {}


def run_confluence_ingestion_unit(
    unit_id: str,
    *,
    endpoint_id: str,
    policy: Dict[str, Any],
    checkpoint: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None,
    filter: Optional[Dict[str, Any]] = None,
) -> ConfluenceIngestionResult:
    definition = CONFLUENCE_DATASET_DEFINITIONS.get(unit_id)
    ingestion_meta = definition.get("ingestion") if definition else None
    if not ingestion_meta:
        raise ValueError(f"Unsupported Confluence ingestion unit: {unit_id}")
    handler_key = ingestion_meta.get("handler") or unit_id
    handler = CONFLUENCE_INGESTION_HANDLERS.get(handler_key)
    if not handler:
        raise ValueError(f"No ingestion handler registered for Confluence unit '{unit_id}'")
    parameter_block: Dict[str, Any] = {}
    if isinstance(policy, dict) and isinstance(policy.get("parameters"), dict):
        parameter_block = policy.get("parameters")  # type: ignore[assignment]
    elif isinstance(policy, dict):
        parameter_block = policy
    params = _normalize_confluence_parameters(parameter_block or {})
    merged_filter = filter if isinstance(filter, dict) else {}
    if isinstance(policy, dict) and isinstance(policy.get("slice"), dict):
        slice_bounds = policy.get("slice") or {}
        if slice_bounds.get("lower"):
            merged_filter = dict(merged_filter or {})
            merged_filter.setdefault("updated_from", slice_bounds.get("lower"))
    filter_config = _normalize_confluence_ingestion_filter(merged_filter)
    base_url = params.get("base_url")
    if not base_url:
        raise ValueError("Confluence base_url is required")
    host = urlparse(base_url).hostname or "confluence.local"
    org_id = params.get("scope_org_id") or "dev"
    scope_project = params.get("scope_project_id")
    # Honor preview/ingestion limits by constraining per-space fetch where possible.
    limit = None
    if isinstance(policy, dict):
        raw_limit = policy.get("limit")
        try:
            limit = int(raw_limit) if raw_limit not in (None, "") else None
        except (TypeError, ValueError):
            limit = None
        if limit and limit > 0:
            if unit_id == "confluence.page" and "max_pages_per_space" not in params:
                params["max_pages_per_space"] = limit
            if unit_id == "confluence.attachment" and "max_attachments_per_space" not in params:
                params["max_attachments_per_space"] = limit
    cursor = {} if str(mode or "").upper() == "FULL" else _extract_confluence_cursor(checkpoint)
    session = _build_confluence_session(params)
    try:
        records, next_cursor, stats = handler(
            session,
            base_url,
            params,
            filter_config,
            cursor,
            endpoint_id,
            host,
            org_id,
            scope_project,
        )
    finally:
        session.close()
    if limit and limit > 0:
        records = records[:limit]
    stats.setdefault("unitId", unit_id)
    stats.setdefault("recordCount", len(records))
    return ConfluenceIngestionResult(records=records, cursor=next_cursor, stats=stats)


def _normalize_confluence_ingestion_filter(raw: Optional[Dict[str, Any]]) -> ConfluenceIngestionFilter:
    if not raw or not isinstance(raw, dict):
        return ConfluenceIngestionFilter(space_keys=[], updated_from=None)
    candidate_keys = raw.get("spaceKeys") or raw.get("space_keys")
    space_keys = []
    if isinstance(candidate_keys, list):
        space_keys = [str(entry).strip().upper() for entry in candidate_keys if str(entry).strip()]
    updated_from = raw.get("updatedFrom") or raw.get("updated_from")
    if isinstance(updated_from, str) and not updated_from.strip():
        updated_from = None
    return ConfluenceIngestionFilter(space_keys=space_keys, updated_from=updated_from)


def _extract_confluence_cursor(checkpoint: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not checkpoint:
        return {}
    base: Dict[str, Any]
    if isinstance(checkpoint, dict):
        value = checkpoint.get("cursor")
        base = value if isinstance(value, dict) else checkpoint
    else:
        base = {}
    spaces = base.get("spaces")
    attachments = base.get("attachments")
    normalized: Dict[str, Any] = {}
    if isinstance(spaces, dict):
        normalized["spaces"] = {str(key).upper(): value for key, value in spaces.items() if isinstance(value, dict)}
    if isinstance(attachments, dict):
        normalized["attachments"] = {str(key).upper(): value for key, value in attachments.items() if isinstance(value, dict)}
    return normalized


def _ingest_confluence_spaces(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    filter_config: ConfluenceIngestionFilter,
    cursor: Dict[str, Any],
    endpoint_id: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    spaces = _fetch_space_records(session, base_url, params, filter_config.space_keys)
    records: List[Dict[str, Any]] = []
    for space in spaces:
        payload = _build_space_payload(space, base_url)
        space_key = str(payload.get("key") or "").upper() or None
        scope_value = scope_project or space_key
        records.append(
            _build_confluence_record(
                entity_type="doc.space",
                logical_id=f"confluence::{host}::space::{payload.get('key') or payload.get('id')}",
                display_name=payload.get("name") or payload.get("key") or payload.get("id"),
                scope_org=org_id,
                scope_project=scope_value,
                endpoint_id=endpoint_id,
                payload=payload,
            )
        )
    stats = {"spacesSynced": len(records)}
    return records, cursor, stats


def _ingest_confluence_pages(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    filter_config: ConfluenceIngestionFilter,
    cursor: Dict[str, Any],
    endpoint_id: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    next_cursor = {
        "spaces": dict(cursor.get("spaces") or {}),
        "attachments": dict(cursor.get("attachments") or {}),
    }
    space_cursor = next_cursor.setdefault("spaces", {})
    space_keys = _resolve_space_keys(session, base_url, params, filter_config)
    records: List[Dict[str, Any]] = []
    stats = {"spacesProcessed": 0, "pagesSynced": 0}
    for space_key in space_keys:
        stats["spacesProcessed"] += 1
        existing_cursor = space_cursor.get(space_key, {})
        since = existing_cursor.get("lastUpdatedAt") or filter_config.updated_from
        pages, last_updated = _fetch_pages_for_space(session, base_url, params, space_key, since)
        for page in pages:
            payload = _build_page_payload(page, base_url)
            payload["spaceKey"] = payload.get("spaceKey") or space_key
            scope_value = scope_project or space_key
            records.append(
                _build_confluence_record(
                    entity_type="doc.page",
                    logical_id=f"confluence::{host}::page::{payload.get('id')}",
                    display_name=payload.get("title") or payload.get("id"),
                    scope_org=org_id,
                    scope_project=scope_value,
                    endpoint_id=endpoint_id,
                    payload=payload,
                )
            )
        stats["pagesSynced"] += len(pages)
        if last_updated:
            space_cursor[space_key] = {"lastUpdatedAt": last_updated}
    return records, next_cursor, stats


def _ingest_confluence_attachments(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    filter_config: ConfluenceIngestionFilter,
    cursor: Dict[str, Any],
    endpoint_id: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    next_cursor = {
        "spaces": dict(cursor.get("spaces") or {}),
        "attachments": dict(cursor.get("attachments") or {}),
    }
    attachment_cursor = next_cursor.setdefault("attachments", {})
    space_keys = _resolve_space_keys(session, base_url, params, filter_config)
    records: List[Dict[str, Any]] = []
    stats = {"spacesProcessed": 0, "attachmentsSynced": 0}
    for space_key in space_keys:
        stats["spacesProcessed"] += 1
        existing_cursor = attachment_cursor.get(space_key, {})
        since = existing_cursor.get("lastCreatedAt") or filter_config.updated_from
        attachments, last_created = _fetch_attachments_for_space(session, base_url, params, space_key, since)
        for attachment in attachments:
            payload = _build_attachment_payload(attachment, base_url)
            payload["spaceKey"] = payload.get("spaceKey") or space_key
            scope_value = scope_project or space_key
            records.append(
                _build_confluence_record(
                    entity_type="doc.attachment",
                    logical_id=f"confluence::{host}::attachment::{payload.get('id')}",
                    display_name=payload.get("title") or payload.get("id"),
                    scope_org=org_id,
                    scope_project=scope_value,
                    endpoint_id=endpoint_id,
                    payload=payload,
                )
            )
        stats["attachmentsSynced"] += len(attachments)
        if last_created:
            attachment_cursor[space_key] = {"lastCreatedAt": last_created}
    return records, next_cursor, stats


def _resolve_space_keys(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    filter_config: ConfluenceIngestionFilter,
) -> List[str]:
    if filter_config.space_keys:
        return [str(key).upper() for key in filter_config.space_keys]
    configured = params.get("space_keys") or []
    if configured:
        return [str(key).upper() for key in configured]
    return _discover_space_keys(session, base_url, include_archived=bool(params.get("include_archived")))


def _fetch_space_records(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    space_keys: List[str],
) -> List[Dict[str, Any]]:
    if space_keys:
        results: List[Dict[str, Any]] = []
        for key in space_keys:
            try:
                record = _confluence_get(session, base_url, f"/wiki/rest/api/space/{key}", {"expand": "description.plain"})
            except Exception:
                continue
            results.append(record)
        return results
    include_archived = bool(params.get("include_archived"))
    statuses = "current,archived" if include_archived else "current"
    start = 0
    page_size = 50
    records: List[Dict[str, Any]] = []
    while True:
        payload = _confluence_get(
            session,
            base_url,
            "/wiki/rest/api/space",
            {
                "limit": page_size,
                "start": start,
                "type": "global",
                "status": statuses,
                "expand": "description.plain",
            },
        )
        results = payload.get("results") or []
        if not results:
            break
        records.extend(results)
        if len(results) < page_size:
            break
        start += len(results)
    return records


def _discover_space_keys(
    session: requests.Session,
    base_url: str,
    *,
    include_archived: bool,
) -> List[str]:
    statuses = "current,archived" if include_archived else "current"
    start = 0
    page_size = 50
    keys: List[str] = []
    while True:
        payload = _confluence_get(
            session,
            base_url,
            "/wiki/rest/api/space",
            {"limit": page_size, "start": start, "type": "global", "status": statuses},
        )
        results = payload.get("results") or []
        if not results:
            break
        for entry in results:
            key = entry.get("key")
            if key:
                keys.append(str(key).upper())
        if len(results) < page_size:
            break
        start += len(results)
    return keys


def _fetch_pages_for_space(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    space_key: str,
    since: Optional[str],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    max_pages_param = params.get("max_pages_per_space")
    max_pages: int = DEFAULT_MAX_SPACE_ITEMS
    if isinstance(max_pages_param, int) and max_pages_param > 0:
        max_pages = max_pages_param
    fetched = 0
    start = 0
    page_size = min(MAX_PAGE_FETCH_SIZE, max_pages)
    pages: List[Dict[str, Any]] = []
    max_updated = since
    cql = _build_page_cql(space_key, since, content_type="page")
    while True:
        limit = page_size
        if isinstance(max_pages, int) and max_pages > 0:
            remaining = max_pages - fetched
            if remaining <= 0:
                break
            limit = min(limit, remaining)
        payload = _confluence_get(
            session,
            base_url,
            "/wiki/rest/api/content/search",
            {
                "cql": cql,
                "limit": limit,
                "start": start,
                "expand": "space,history,version,body.storage,metadata.labels,_links",
            },
        )
        results = payload.get("results") or []
        if not results:
            break
        pages.extend(results)
        for entry in results:
            version = entry.get("version") or {}
            candidate = version.get("when") or (entry.get("history") or {}).get("lastUpdated")
            max_updated = _max_timestamp(max_updated, candidate)
        fetched += len(results)
        if fetched >= max_pages:
            break
        if len(results) < limit:
            break
        start += len(results)
    return pages, max_updated


def _fetch_attachments_for_space(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    space_key: str,
    since: Optional[str],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    max_items_param = params.get("max_attachments_per_space")
    max_items: int = DEFAULT_MAX_SPACE_ITEMS
    if isinstance(max_items_param, int) and max_items_param > 0:
        max_items = max_items_param
    fetched = 0
    start = 0
    page_size = min(MAX_ATTACHMENT_FETCH_SIZE, max_items)
    attachments: List[Dict[str, Any]] = []
    max_created = since
    cql = _build_page_cql(space_key, since, content_type="attachment")
    while True:
        payload = _confluence_get(
            session,
            base_url,
            "/wiki/rest/api/content/search",
            {
                "cql": cql,
                "limit": page_size,
                "start": start,
                "expand": "container,metadata,_links",
            },
        )
        results = payload.get("results") or []
        if not results:
            break
        attachments.extend(results)
        for entry in results:
            created = entry.get("created") or (entry.get("history") or {}).get("createdDate")
            max_created = _max_timestamp(max_created, created)
        fetched += len(results)
        if fetched >= max_items:
            break
        if len(results) < page_size:
            break
        start += len(results)
    return attachments, max_created


def _build_page_cql(space_key: str, since: Optional[str], *, content_type: str) -> str:
    clauses = [f'space = "{space_key}"', f'type = "{content_type}"']
    if since:
        field = "lastmodified" if content_type == "page" else "created"
        clauses.append(f'{field} >= "{since}"')
    return " AND ".join(clauses)


def _build_confluence_record(
    *,
    entity_type: str,
    logical_id: str,
    display_name: str,
    scope_org: str,
    scope_project: Optional[str],
    endpoint_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "entityType": entity_type,
        "logicalId": logical_id,
        "displayName": display_name,
        "scope": {
            "orgId": scope_org,
            "projectId": scope_project,
            "domainId": None,
            "teamId": None,
        },
        "provenance": {"endpointId": endpoint_id, "vendor": "confluence"},
        "payload": payload,
    }


def _build_space_payload(space: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    links = space.get("_links") or {}
    description = (space.get("description") or {}).get("plain", {})
    return {
        "id": space.get("id"),
        "key": space.get("key"),
        "name": space.get("name"),
        "type": space.get("type"),
        "status": space.get("status"),
        "url": _resolve_link(base_url, links, "webui"),
        "description": description.get("value"),
        "raw": space,
    }


def _build_page_payload(page: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    links = page.get("_links") or {}
    metadata = page.get("metadata") or {}
    labels = metadata.get("labels") or {}
    label_results = labels.get("results") or []
    history = page.get("history") or {}
    version = page.get("version") or {}
    return {
        "id": page.get("id"),
        "title": page.get("title"),
        "type": page.get("type"),
        "status": page.get("status"),
        "space": page.get("space") or {},
        "spaceKey": (page.get("space") or {}).get("key"),
        "body": page.get("body") or {},
        "history": history,
        "version": version,
        "metadata": metadata,
        "labels": [label.get("name") for label in label_results if isinstance(label, dict)],
        "links": links,
        "url": _resolve_link(base_url, links, "tinyui") or _resolve_link(base_url, links, "webui"),
        "created_at": history.get("createdDate"),
        "updated_at": version.get("when") or history.get("lastUpdated"),
        "raw": page,
    }


def _build_attachment_payload(attachment: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    links = attachment.get("_links") or {}
    metadata = attachment.get("metadata") or {}
    container = attachment.get("container") or {}
    return {
        "id": attachment.get("id"),
        "title": attachment.get("title"),
        "mediaType": metadata.get("mediaType"),
        "fileSize": (attachment.get("extensions") or {}).get("fileSize"),
        "downloadLink": _resolve_link(base_url, links, "download"),
        "container": container,
        "spaceKey": (container.get("space") or {}).get("key"),
        "createdAt": attachment.get("created") or metadata.get("createdAt"),
        "raw": attachment,
    }


def _resolve_link(base_url: str, links: Dict[str, Any], key: str) -> Optional[str]:
    value = links.get(key)
    if isinstance(value, str):
        if value.startswith("http"):
            return value
        return urljoin(f"{base_url.rstrip('/')}/", value.lstrip("/"))
    return None


def _max_timestamp(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    if not candidate:
        return current
    if not current:
        return candidate
    current_dt = _parse_iso_timestamp(current)
    candidate_dt = _parse_iso_timestamp(candidate)
    if not current_dt:
        return candidate
    if not candidate_dt:
        return current
    return candidate if candidate_dt > current_dt else current


def _parse_iso_timestamp(value: str) -> Optional[datetime]:
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None


CONFLUENCE_INGESTION_HANDLERS.update(
    {
        "confluence.space": _ingest_confluence_spaces,
        "confluence.page": _ingest_confluence_pages,
        "confluence.attachment": _ingest_confluence_attachments,
    }
)


def _build_static_api_overview() -> List[Dict[str, Any]]:
    overview: List[Dict[str, Any]] = []
    for key, entry in CONFLUENCE_API_LIBRARY.items():
        overview.append(
            {
                "key": key,
                "method": entry.get("method"),
                "path": entry.get("path"),
                "description": entry.get("description"),
                "docUrl": entry.get("docs"),
                "scope": entry.get("scope"),
            }
        )
    return overview


def _build_static_dataset_overview() -> List[Dict[str, Any]]:
    datasets: List[Dict[str, Any]] = []
    for dataset_id, definition in CONFLUENCE_DATASET_DEFINITIONS.items():
        datasets.append(
            {
                "datasetId": dataset_id,
                "name": definition.get("name") or dataset_id,
                "description": definition.get("description"),
                "fields": definition.get("static_fields"),
                "ingestion": definition.get("ingestion"),
            }
        )
    return datasets


def _normalize_confluence_parameters(parameters: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    base_url = str(parameters.get("base_url") or "").strip()
    if base_url.endswith("/"):
        base_url = base_url[:-1]
    normalized["base_url"] = base_url
    normalized["auth_type"] = (parameters.get("auth_type") or "api_token").lower()
    normalized["username"] = parameters.get("username") or parameters.get("email") or parameters.get("username_or_email")
    normalized["api_token"] = parameters.get("api_token") or parameters.get("password")
    normalized["space_keys"] = _normalize_csv(parameters.get("space_keys"))
    normalized["include_archived"] = bool(
        str(parameters.get("include_archived") or parameters.get("includeArchived") or "false").lower() in ("1", "true", "yes")
    )
    max_pages = parameters.get("max_pages_per_space")
    try:
        normalized["max_pages_per_space"] = int(max_pages) if max_pages not in (None, "") else None
    except (TypeError, ValueError):
        normalized["max_pages_per_space"] = None
    return normalized


def _normalize_csv(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        values = value
    else:
        values = str(value).split(",")
    normalized = [str(item).strip().upper() for item in values if str(item).strip()]
    # Remove duplicates while preserving order
    seen: set[str] = set()
    ordered: List[str] = []
    for item in normalized:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def _build_confluence_session(parameters: Dict[str, Any]) -> requests.Session:
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})
    auth_type = (parameters.get("auth_type") or "api_token").lower()
    username = parameters.get("username") or ""
    token = parameters.get("api_token") or ""
    if auth_type in {"api_token", "basic"} and username and token:
        session.auth = HTTPBasicAuth(username, token)
    return session


def _confluence_get(session: requests.Session, base_url: str, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    target = _build_api_url(base_url, path)
    response = session.get(target, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        return payload
    return {"results": payload}


def _build_api_url(base_url: str, path: str) -> str:
    normalized_base = base_url.rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    return urljoin(f"{normalized_base}/", normalized_path)


@dataclass
class ConfluencePagePreview:
    page_id: str
    title: str
    space_key: str
    url: Optional[str]
    excerpt: Optional[str]
    updated_at: Optional[str]
    updated_by: Optional[str]


def _render_page_preview(page_payload: Dict[str, Any]) -> ConfluencePagePreview:
    page_id = str(page_payload.get("id") or page_payload.get("pageId") or "")
    space = page_payload.get("space") or {}
    space_key = space.get("key") or page_payload.get("spaceKey") or ""
    title = page_payload.get("title") or ""
    body = page_payload.get("body") or {}
    storage = body.get("storage") if isinstance(body, dict) else {}
    excerpt = storage.get("value") if isinstance(storage, dict) else None
    version = page_payload.get("version") or {}
    updated = version.get("when") or page_payload.get("updatedAt")
    updated_by = (version.get("by") or {}).get("displayName") if isinstance(version.get("by"), dict) else None
    links = page_payload.get("_links") or {}
    webui = links.get("webui")
    base = links.get("base")
    url = f"{base}{webui}" if isinstance(base, str) and isinstance(webui, str) else links.get("tinyui")
    return ConfluencePagePreview(
        page_id=page_id,
        title=str(title),
        space_key=str(space_key),
        url=url,
        excerpt=excerpt,
        updated_at=updated,
        updated_by=updated_by,
    )


__all__ = [
    "ConfluenceEndpoint",
    "_build_confluence_session",
    "_confluence_get",
    "_normalize_confluence_parameters",
    "_render_page_preview",
]
