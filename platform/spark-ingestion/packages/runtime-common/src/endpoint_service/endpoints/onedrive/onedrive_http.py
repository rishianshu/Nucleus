from __future__ import annotations

# mypy: disable-error-code=import-untyped

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin

import requests

from ingestion_models.endpoints import (
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointConnectionTemplate,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingPlan,
    EndpointTestResult,
    EndpointUnitDescriptor,
    IngestionCapableEndpoint,
    IngestionPlan,
    IngestionSlice,
    MetadataSubsystem,
    SupportsIncrementalPlanning,
    SupportsIngestionExecution,
    SupportsPreview,
)
from endpoint_service.endpoints.onedrive.onedrive_catalog import (
    DEFAULT_CURSOR_FIELD,
    DEFAULT_ONEDRIVE_DATASET,
    ONEDRIVE_DATASET_DEFINITIONS,
    build_static_api_overview,
    build_static_dataset_overview,
    build_static_unit_overview,
)

DEFAULT_SLICE_WINDOW_DAYS = 30
MAX_PREVIEW_ITEMS = 50


def _csv_list(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(entry).strip() for entry in raw if str(entry).strip()]
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None


def _coerce_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "y"):
            return True
        if lowered in ("false", "0", "no", "n"):
            return False
    return None


def _normalize_onedrive_parameters(parameters: Dict[str, Any]) -> Dict[str, Any]:
    params = {k: (v.strip() if isinstance(v, str) else v) for k, v in (parameters or {}).items()}
    base_url = params.get("base_url") or params.get("baseUrl") or OneDriveEndpoint.GRAPH_BASE_URL
    drive_id = params.get("drive_id") or params.get("driveId") or params.get("drive")
    root_path = params.get("root_path") or params.get("rootPath") or "/"
    auth_mode_raw = params.get("auth_mode") or params.get("authMode")
    auth_block = params.get("auth")
    if isinstance(auth_block, dict):
        auth_mode_raw = auth_mode_raw or auth_block.get("mode")
    auth_mode = str(auth_mode_raw or "stub").lower()
    delegated_connected = _coerce_bool(params.get("delegated_connected") or params.get("delegatedConnected"))
    access_token = params.get("access_token") or params.get("delegated_token") or params.get("token")
    return {
        "base_url": str(base_url).rstrip("/") + "/",
        "drive_id": drive_id,
        "root_path": root_path if str(root_path).startswith("/") else f"/{root_path}",
        "include_file_types": _csv_list(params.get("include_file_types") or params.get("includeFileTypes")),
        "exclude_patterns": _csv_list(params.get("exclude_patterns") or params.get("excludePatterns")),
        "tenant_id": params.get("tenant_id"),
        "client_id": params.get("client_id"),
        "client_secret": params.get("client_secret"),
        "scope_org_id": params.get("scope_org_id") or params.get("scopeOrgId") or "dev",
        "scope_project_id": params.get("scope_project_id") or params.get("scopeProjectId"),
        "auth_mode": auth_mode,
        "delegated_connected": delegated_connected if delegated_connected is not None else False,
        "access_token": access_token,
    }


def _build_onedrive_session(params: Dict[str, Any]) -> requests.Session:
    session = requests.Session()
    auth_mode = str(params.get("auth_mode") or "stub").lower()
    token = params.get("client_secret")
    if auth_mode == "delegated":
        token = params.get("access_token") or params.get("client_secret")
    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
    return session


def _onedrive_get(session: requests.Session, base_url: str, path: str) -> Dict[str, Any]:
    url = urljoin(base_url, path)
    resp = session.get(url, timeout=5)
    if not resp.ok:
        return {}
    try:
        data = resp.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _fetch_children(session: requests.Session, base_url: str, drive_id: str, item_id: Optional[str]) -> List[Dict[str, Any]]:
    target = "root" if item_id in (None, "root") else f"items/{item_id}"
    payload = _onedrive_get(session, base_url, f"drives/{drive_id}/{target}/children")
    return payload.get("value") or []


def _iter_drive_items(
    session: requests.Session,
    base_url: str,
    drive_id: str,
    *,
    root_path: str = "/",
    max_items: Optional[int] = None,
) -> Iterable[Dict[str, Any]]:
    queue: List[Tuple[Optional[str], str]] = [("root", root_path or "/")]
    seen = 0
    while queue:
        item_id, parent_path = queue.pop(0)
        for child in _fetch_children(session, base_url, drive_id, item_id):
            name = child.get("name") or child.get("id")
            child_path = f"{parent_path.rstrip('/')}/{name}".replace("//", "/")
            child["path"] = child.get("path") or child_path
            child["driveId"] = drive_id
            if child.get("folder") is not None:
                queue.append((child.get("id"), child_path))
                continue
            yield child
            seen += 1
            if max_items and seen >= max_items:
                return


def _matches_filters(item: Dict[str, Any], includes: List[str], excludes: List[str]) -> bool:
    name = str(item.get("name") or item.get("id") or "").lower()
    if includes:
        if "." in name:
            ext = name.rsplit(".", 1)[-1]
            if ext not in {entry.lower() for entry in includes}:
                return False
        else:
            return False
    for pattern in excludes:
        if pattern.lower() in name:
            return False
    return True


@dataclass
class OneDriveIngestionResult:
    records: List[Dict[str, Any]]
    cursor: Dict[str, Any]
    stats: Dict[str, Any]


class OneDriveEndpoint(IngestionCapableEndpoint, SupportsIncrementalPlanning, SupportsIngestionExecution, SupportsPreview):
    """OneDrive endpoint descriptor using Microsoft Graph (or a local stub)."""

    TEMPLATE_ID = "http.onedrive"
    DISPLAY_NAME = "OneDrive"
    VENDOR = "Microsoft"
    DESCRIPTION = "Connect to OneDrive via Microsoft Graph (supports metadata, preview, ingestion)."
    DOMAIN = "docs"
    DEFAULT_LABELS = ("onedrive", "docs")
    DESCRIPTOR_VERSION = "1.0"
    GRAPH_BASE_URL = os.environ.get("ONEDRIVE_GRAPH_BASE_URL", "https://graph.microsoft.com/v1.0")
    STUB_ENV_FLAG = os.environ.get("ONEDRIVE_GRAPH_STUB", "0")

    PROBING_PLAN = EndpointProbingPlan(
        methods=(),
        fallback_message="Provide drive/root path. When ONEDRIVE_GRAPH_BASE_URL points to a stub, no external network is required.",
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
            categories=("saas", "storage"),
            protocols=("https",),
            docs_url="https://learn.microsoft.com/graph/onedrive-concept-overview",
            agent_prompt="Collect tenant/client credentials and the drive/root path to enumerate files. For CI, use the local stub via ONEDRIVE_GRAPH_BASE_URL.",
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            connection=EndpointConnectionTemplate(
                url_template="{base_url}",
                default_verb="GET",
            ),
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.PROBING_PLAN,
            extras={
                "apiCatalog": build_static_api_overview(),
                "datasets": build_static_dataset_overview(),
                "ingestionUnits": build_static_unit_overview(),
            },
        )

    @classmethod
    def descriptor_fields(cls):
        return (
            EndpointFieldDescriptor(
                key="tenant_id",
                label="Tenant ID",
                value_type="STRING",
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
                description="Azure AD tenant ID. Not required for stub mode.",
                required=False,
                advanced=True,
            ),
            EndpointFieldDescriptor(
                key="client_id",
                label="Client ID",
                value_type="STRING",
                placeholder="Azure AD app client ID",
                description="Client ID for the Graph app. Not required for stub mode.",
                required=False,
                advanced=True,
            ),
            EndpointFieldDescriptor(
                key="client_secret",
                label="Client Secret",
                value_type="PASSWORD",
                placeholder="Azure AD app client secret",
                description="Client secret for the Graph app. Not required for stub mode.",
                required=False,
                sensitive=True,
                advanced=True,
            ),
            EndpointFieldDescriptor(
                key="drive_id",
                label="Drive ID",
                value_type="STRING",
                placeholder="drive-id or 'me'",
                description="Target drive (id or 'me'). For stub, use any string.",
            ),
            EndpointFieldDescriptor(
                key="root_path",
                label="Root path",
                value_type="STRING",
                placeholder="/",
                default_value="/",
                description="Root path within the drive to scan (e.g., /, /Projects).",
            ),
            EndpointFieldDescriptor(
                key="include_file_types",
                label="Include file types",
                value_type="STRING",
                required=False,
                placeholder="docx,md,txt,pdf",
                description="Comma-separated list of file extensions to include.",
            ),
            EndpointFieldDescriptor(
                key="exclude_patterns",
                label="Exclude patterns",
                value_type="STRING",
                required=False,
                placeholder="tmp,~$",
                description="Comma-separated substrings to exclude from file names.",
            ),
            EndpointFieldDescriptor(
                key="base_url",
                label="Graph base URL",
                value_type="URL",
                required=False,
                placeholder=cls.GRAPH_BASE_URL,
                description="Override Graph base URL (use stub URL in CI). Defaults to ONEDRIVE_GRAPH_BASE_URL or https://graph.microsoft.com/v1.0.",
                advanced=True,
            ),
        )

    @classmethod
    def descriptor_capabilities(cls):
        return (
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Metadata collection",
                description="Enumerates files/folders to emit catalog datasets.",
            ),
            EndpointCapabilityDescriptor(
                key="preview",
                label="Preview",
                description="Supports lightweight previews for text-like docs.",
            ),
            EndpointCapabilityDescriptor(
                key="ingestion",
                label="Ingestion",
                description="Plans slices and ingests docs via staging/CDM sinks.",
            ),
        )

    @classmethod
    def _use_stub(cls, parameters: Dict[str, Any]) -> bool:
        auth_mode = str(parameters.get("auth_mode") or "").lower()
        if auth_mode == "stub":
            return True
        base_url = str(parameters.get("base_url") or cls.GRAPH_BASE_URL)
        return cls.STUB_ENV_FLAG == "1" or base_url.startswith("http://localhost") or base_url.startswith("https://localhost")

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = _normalize_onedrive_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        descriptor = cls.descriptor()
        connection = descriptor.connection
        if not connection:
            raise ValueError(f"Endpoint {descriptor.id} is missing a connection template.")
        url = normalized["base_url"]
        return EndpointConnectionResult(
            url=url,
            config={"templateId": cls.TEMPLATE_ID, "parameters": normalized},
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=connection.default_verb,
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = _normalize_onedrive_parameters(parameters)
        drive_id = normalized.get("drive_id")
        base_url = str(normalized.get("base_url") or cls.GRAPH_BASE_URL)
        auth_mode = str(normalized.get("auth_mode") or "stub")
        if not drive_id:
            return EndpointTestResult(False, "drive_id is required.")
        if cls._use_stub(normalized):
            return EndpointTestResult(
                True,
                "Stub Graph validated (no network).",
                capabilities=("metadata", "preview", "ingestion"),
                detected_version="stub",
            )
        if auth_mode == "delegated" and not normalized.get("access_token"):
            return EndpointTestResult(
                True,
                "Delegated auth pending browser sign-in; token not present yet.",
                capabilities=("metadata", "preview", "ingestion"),
                detected_version="delegated",
            )
        session = _build_onedrive_session(normalized)
        try:
            resp = session.get(urljoin(base_url, f"drives/{drive_id}"), timeout=5)
            if resp.status_code in (200, 401, 403):
                return EndpointTestResult(
                    True,
                    f"Graph reachable (status {resp.status_code}); configure auth for real runs.",
                    capabilities=("metadata", "preview", "ingestion"),
                    detected_version=resp.headers.get("OData-Version") or "graph",
                )
            return EndpointTestResult(False, f"Graph returned HTTP {resp.status_code}")
        except Exception as exc:  # pragma: no cover - network dependent
            return EndpointTestResult(False, f"Failed to reach Graph: {exc}")
        finally:
            session.close()

    # --- BaseEndpoint protocol -------------------------------------------------
    def __init__(self, tool, endpoint_cfg: Dict[str, Any], table_cfg: Dict[str, Any], metadata_access: MetadataSubsystem | None = None, emitter=None) -> None:
        self.tool = tool
        self.endpoint_cfg = dict(endpoint_cfg)
        self.table_cfg = dict(table_cfg)
        self.metadata_access: MetadataSubsystem | None = metadata_access
        if self.metadata_access is None:
            try:
                from endpoint_service.endpoints.onedrive.metadata import OneDriveMetadataSubsystem
                self.metadata_access = OneDriveMetadataSubsystem(self)
            except Exception:
                self.metadata_access = None
        self.emitter = emitter
        self._caps = EndpointCapabilities(
            supports_full=True,
            supports_incremental=True,
            supports_metadata=True,
            supports_preview=True,
            incremental_literal="timestamp",
        )

    def configure(self, table_cfg: Dict[str, Any]) -> None:  # pragma: no cover
        self.table_cfg.update(table_cfg)

    def capabilities(self) -> EndpointCapabilities:
        return self._caps

    def describe(self) -> Dict[str, Any]:
        return {
            "drive_id": self.endpoint_cfg.get("drive_id"),
            "root_path": self.endpoint_cfg.get("root_path"),
            "base_url": self.endpoint_cfg.get("base_url") or self.GRAPH_BASE_URL,
            "dialect": "onedrive",
        }

    def metadata_subsystem(self) -> MetadataSubsystem:
        if self.metadata_access is None:  # pragma: no cover - defensive
            raise RuntimeError("OneDrive metadata subsystem unavailable")
        return self.metadata_access

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        units: List[EndpointUnitDescriptor] = []
        for dataset_id, definition in ONEDRIVE_DATASET_DEFINITIONS.items():
            ingestion_meta = definition.get("ingestion") or {}
            unit_id = ingestion_meta.get("unit_id") or dataset_id
            units.append(
                EndpointUnitDescriptor(
                    unit_id=unit_id,
                    kind="dataset",
                    display_name=ingestion_meta.get("display_name") or definition.get("name") or unit_id,
                    description=ingestion_meta.get("description") or definition.get("description"),
                    supports_incremental=bool(ingestion_meta.get("supports_incremental", True)),
                    ingestion_strategy=ingestion_meta.get("ingestion_strategy") or "onedrive-lastmodified",
                    incremental_column=ingestion_meta.get("incremental_column") or DEFAULT_CURSOR_FIELD,
                    incremental_literal=ingestion_meta.get("incremental_literal") or "timestamp",
                    default_policy=ingestion_meta.get("default_policy"),
                    cdm_model_id=ingestion_meta.get("cdm_model_id"),
                )
            )
        return units

    def plan_incremental_slices(
        self,
        *,
        unit: EndpointUnitDescriptor,
        checkpoint: Optional[Dict[str, Any]],
        policy: Optional[Dict[str, Any]] = None,
        target_slice_size: Optional[int] = None,
    ) -> IngestionPlan:
        cursor = _extract_onedrive_cursor(checkpoint)
        now = datetime.now(timezone.utc)
        default_lower = cursor.get("lastModified") or (now - timedelta(days=DEFAULT_SLICE_WINDOW_DAYS)).isoformat()
        lower = default_lower
        upper = now.isoformat()
        slices = [
            IngestionSlice(
                key=f"{unit.unit_id}:slice:0",
                sequence=0,
                params={"lower": lower, "upper": upper},
                lower=lower,
                upper=upper,
            )
        ]
        statistics = {"cursor": cursor, "target_slice_size": target_slice_size}
        return IngestionPlan(
            endpoint_id=self.table_cfg.get("endpoint_id") or "",
            unit_id=unit.unit_id,
            slices=slices,
            statistics=statistics,
            strategy="onedrive-lastmodified",
        )

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
    ) -> OneDriveIngestionResult:
        if unit_id == "onedrive.acl":
            return self.ingest_acl(endpoint_id=endpoint_id, policy=policy, checkpoint=checkpoint)
        params = _normalize_onedrive_parameters(_parameter_block(policy))
        base_url = str(params.get("base_url") or self.GRAPH_BASE_URL)
        drive_id = params.get("drive_id")
        if not drive_id:
            raise ValueError("drive_id is required for OneDrive ingestion")
        slice_bounds = _extract_slice_bounds(policy)
        lower_bound = _parse_timestamp(slice_bounds.get("lower") or _extract_onedrive_cursor(checkpoint).get("lastModified"))
        upper_bound = _parse_timestamp(slice_bounds.get("upper"))
        session = _build_onedrive_session(params)
        records: List[Dict[str, Any]] = []
        max_last_modified: Optional[datetime] = None
        try:
            for item in _iter_drive_items(session, base_url, drive_id, root_path=params.get("root_path") or "/"):
                if not _matches_filters(item, params.get("include_file_types") or [], params.get("exclude_patterns") or []):
                    continue
                lm = _parse_timestamp(item.get(DEFAULT_CURSOR_FIELD))
                if lower_bound and lm and lm <= lower_bound:
                    continue
                if upper_bound and lm and lm > upper_bound:
                    continue
                max_last_modified = lm if (lm and (max_last_modified is None or lm > max_last_modified)) else max_last_modified
                records.append(
                    {
                        "entityType": "doc.item",
                        "logicalId": f"onedrive::{drive_id}::{item.get('id')}",
                        "displayName": item.get("name") or item.get("id"),
                        "scope": {
                            "orgId": params.get("scope_org_id") or "dev",
                            "projectId": params.get("scope_project_id"),
                            "domainId": None,
                            "teamId": None,
                        },
                        "provenance": {"endpointId": endpoint_id, "vendor": "onedrive"},
                        "payload": {
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "path": item.get("path"),
                            "file": item.get("file"),
                            "folder": item.get("folder"),
                            "size": item.get("size"),
                            "webUrl": item.get("webUrl"),
                            "driveId": drive_id,
                            DEFAULT_CURSOR_FIELD: item.get(DEFAULT_CURSOR_FIELD),
                            "raw": item,
                        },
                    }
                )
        finally:
            session.close()
        cursor = {}
        if max_last_modified:
            cursor["lastModified"] = max_last_modified.isoformat()
        stats = {
            "unitId": unit_id,
            "recordCount": len(records),
            "cursor": cursor or checkpoint,
            "filters": {
                "include": params.get("include_file_types"),
                "exclude": params.get("exclude_patterns"),
                "root_path": params.get("root_path"),
            },
        }
        return OneDriveIngestionResult(records=records, cursor=cursor or checkpoint or {}, stats=stats)

    def ingest_acl(
        self,
        *,
        endpoint_id: str,
        policy: Dict[str, Any],
        checkpoint: Optional[Dict[str, Any]] = None,
    ) -> OneDriveIngestionResult:
        params = _normalize_onedrive_parameters(_parameter_block(policy))
        base_url = str(params.get("base_url") or self.GRAPH_BASE_URL)
        drive_id = params.get("drive_id")
        if not drive_id:
            raise ValueError("drive_id is required for OneDrive ACL ingestion")
        principal_ids: List[str] = []
        raw_principals = params.get("acl_principals") or []
        if isinstance(raw_principals, str):
            principal_ids = [raw_principals]
        elif isinstance(raw_principals, list):
            principal_ids = [str(entry) for entry in raw_principals if entry]
        if not principal_ids:
            principal_ids = ["onedrive:public"]
        # Include the configured client_id as a synthetic principal hint for dev/stub
        client_id = params.get("client_id") or params.get("clientId")
        if client_id:
            principal_ids.append(f"onedrive:app:{client_id}")
        session = _build_onedrive_session(params)
        records: List[Dict[str, Any]] = []
        try:
            for item in _iter_drive_items(session, base_url, drive_id, root_path=params.get("root_path") or "/"):
                doc_cdm_id = f"cdm:doc:item:onedrive:{item.get('id')}"
                for principal in principal_ids:
                    logical_id = f"onedrive::{drive_id}::acl::{item.get('id')}::{principal}"
                    records.append(
                        {
                            "entityType": "cdm.doc.access",
                            "logicalId": logical_id,
                            "displayName": f"{principal} -> {item.get('id')}",
                            "scope": {
                                "orgId": params.get("scope_org_id") or "dev",
                                "projectId": params.get("scope_project_id"),
                                "domainId": None,
                                "teamId": None,
                            },
                            "provenance": {"endpointId": endpoint_id, "vendor": "onedrive"},
                            "payload": {
                                "principal_id": principal,
                                "principal_type": "group" if principal.startswith("onedrive:") else "user",
                                "doc_cdm_id": doc_cdm_id,
                                "source_system": "onedrive",
                                "granted_at": item.get("lastModifiedDateTime"),
                                "synced_at": datetime.now(timezone.utc).isoformat(),
                                "dataset_id": "onedrive.docs",
                                "endpoint_id": endpoint_id,
                            },
                        }
                    )
        finally:
            session.close()
        stats = {"recordCount": len(records)}
        return OneDriveIngestionResult(records=records, cursor=checkpoint or {}, stats=stats)

    def preview(
        self,
        *,
        unit_id: Optional[str] = None,
        limit: int = 50,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        subsystem = self.metadata_subsystem()
        if subsystem and hasattr(subsystem, "preview_dataset"):
            dataset_id = unit_id or self.table_cfg.get("dataset") or self.table_cfg.get("table") or DEFAULT_ONEDRIVE_DATASET
            return subsystem.preview_dataset(dataset_id=dataset_id, limit=limit, config=self.endpoint_cfg)
        # Fallback: fetch directly
        params = _normalize_onedrive_parameters(self.endpoint_cfg)
        base_url = str(params.get("base_url") or self.GRAPH_BASE_URL)
        drive_id = params.get("drive_id")
        if not drive_id:
            return []
        session = _build_onedrive_session(params)
        try:
            return list(_iter_drive_items(session, base_url, drive_id, root_path=params.get("root_path") or "/", max_items=min(limit, MAX_PREVIEW_ITEMS)))
        finally:
            session.close()


def _parameter_block(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(policy, dict):
        return {}
    params = policy.get("parameters")
    if isinstance(params, dict):
        return dict(params)
    return dict(policy)


def _extract_onedrive_cursor(checkpoint: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(checkpoint, dict):
        return {}
    cursor = checkpoint.get("cursor") if isinstance(checkpoint.get("cursor"), dict) else checkpoint
    normalized: Dict[str, Any] = {}
    if isinstance(cursor, dict):
        if cursor.get("lastModified"):
            normalized["lastModified"] = cursor.get("lastModified")
        elif cursor.get("last_modified"):
            normalized["lastModified"] = cursor.get("last_modified")
    return normalized


def _extract_slice_bounds(policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(policy, dict):
        return {}
    slice_block = policy.get("slice") or {}
    return slice_block if isinstance(slice_block, dict) else {}


__all__ = [
    "OneDriveEndpoint",
    "_iter_drive_items",
    "_onedrive_get",
    "_build_onedrive_session",
    "_normalize_onedrive_parameters",
]
