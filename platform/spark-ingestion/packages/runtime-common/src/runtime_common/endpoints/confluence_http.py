from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from requests.auth import HTTPBasicAuth

try:
    from metadata_service.adapters import ConfluenceMetadataSubsystem as _ConfluenceMetadataSubsystem  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    _ConfluenceMetadataSubsystem = None  # type: ignore

from .base import (
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
    MetadataSubsystem,
    SourceEndpoint,
)
from .confluence_catalog import CONFLUENCE_API_LIBRARY, CONFLUENCE_DATASET_DEFINITIONS


class ConfluenceEndpoint(SourceEndpoint):
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
        base_url = normalized.get("base_url")
        if not base_url:
            raise ValueError("base_url is required")
        return EndpointConnectionResult(url=base_url, config=normalized, labels=("confluence", "semantic"))

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = _normalize_confluence_parameters(parameters)
        base_url = normalized.get("base_url")
        if not base_url:
            return EndpointTestResult(success=False, message="Confluence base_url is required.")
        session = _build_confluence_session(normalized)
        try:
            user_info = _confluence_get(session, base_url, "/wiki/rest/api/user/current")
            site_info = _confluence_get(session, base_url, "/wiki/rest/api/settings/systemInfo")
        finally:
            session.close()
        version = site_info.get("versionNumber") if isinstance(site_info, dict) else None
        return EndpointTestResult(
            success=True,
            message=f"Authenticated as {user_info.get('displayName') or user_info.get('username')}.",
            detected_version=str(version or ""),
            capabilities=("metadata", "preview"),
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
            subsystem_cls = _load_confluence_metadata_subsystem()
            self.metadata_access = subsystem_cls(self) if subsystem_cls else None
        self.emitter = emitter
        self._caps = EndpointCapabilities(
            supports_full=True,
            supports_incremental=False,
            supports_metadata=bool(self.metadata_access),
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

    def metadata_subsystem(self) -> MetadataSubsystem | None:
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
            units.append(
                EndpointUnitDescriptor(
                    unit_id=unit_id,
                    kind="dataset",
                    display_name=ingestion_meta.get("display_name") or definition.get("name") or unit_id,
                    description=ingestion_meta.get("description") or definition.get("description"),
                    supports_incremental=bool(ingestion_meta.get("supports_incremental")),
                    default_policy=ingestion_meta.get("default_policy"),
                    cdm_model_id=ingestion_meta.get("cdm_model_id"),
                )
            )
        return units


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


def _load_confluence_metadata_subsystem():
    global _ConfluenceMetadataSubsystem
    if _ConfluenceMetadataSubsystem is None:
        try:  # pragma: no cover - lazy import for metadata adapters
            from metadata_service.adapters import ConfluenceMetadataSubsystem as _Subsystem  # type: ignore

            _ConfluenceMetadataSubsystem = _Subsystem  # type: ignore
        except Exception:  # pragma: no cover - dependency not available
            return None
    return _ConfluenceMetadataSubsystem


__all__ = [
    "ConfluenceEndpoint",
    "_build_confluence_session",
    "_confluence_get",
    "_normalize_confluence_parameters",
    "_render_page_preview",
]
