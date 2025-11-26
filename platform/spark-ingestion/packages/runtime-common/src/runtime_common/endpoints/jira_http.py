from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from requests.auth import HTTPBasicAuth

try:
    from metadata_service.adapters import JiraMetadataSubsystem as _JiraMetadataSubsystem  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    _JiraMetadataSubsystem = None  # type: ignore

from .base import (
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionTemplate,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointProbingPlan,
    EndpointUnitDescriptor,
    MetadataSubsystem,
    SourceEndpoint,
)
from .jira_catalog import JIRA_API_LIBRARY, JIRA_DATASET_DEFINITIONS


class JiraEndpoint(SourceEndpoint):
    """Jira REST endpoint descriptor + placeholder source implementation."""

    TEMPLATE_ID = "jira.http"
    DISPLAY_NAME = "Jira"
    VENDOR = "Atlassian"
    DESCRIPTION = "Connect to Jira Cloud/Server REST APIs for semantic ingestion."
    DOMAIN = "work.jira"
    DEFAULT_LABELS = ("jira", "semantic")
    DESCRIPTOR_VERSION = "1.0"
    PROBING_PLAN = EndpointProbingPlan(
        methods=(
            EndpointProbingMethod(
                key="jira_server_info",
                label="GET /rest/api/3/serverInfo",
                strategy="HTTP",
                statement="GET {base_url}/rest/api/3/serverInfo",
                description="Retrieves server information to confirm connectivity and version.",
                requires=("base_url",),
            ),
            EndpointProbingMethod(
                key="jira_myself",
                label="GET /rest/api/3/myself",
                strategy="HTTP",
                statement="GET {base_url}/rest/api/3/myself",
                description="Validates credentials by calling the /myself endpoint.",
                requires=("base_url",),
            ),
        ),
        fallback_message="Provide the Jira version manually if API calls are restricted.",
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
            categories=("work-management", "semantic"),
            protocols=("https",),
            docs_url="https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
            agent_prompt="Collect the Jira base URL (https://<domain>.atlassian.net), authentication method, and optional project filters (comma-separated project keys or JQL).",
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            connection=EndpointConnectionTemplate(url_template="{base_url}", default_verb="GET"),
            driver="jira",
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.PROBING_PLAN,
            sample_config={
                "projectKeys": [],
                "jqlFilter": None,
            },
            extras={
                "apiCatalog": _build_static_api_overview(),
                "ingestionUnits": _build_static_unit_overview(),
            },
        )

    @classmethod
    def descriptor_fields(cls):
        return (
            EndpointFieldDescriptor(
                key="base_url",
                label="Base URL",
                value_type="URL",
                placeholder="https://your-domain.atlassian.net",
                description="Root Jira URL without trailing slash.",
            ),
            EndpointFieldDescriptor(
                key="auth_type",
                label="Authentication",
                value_type="ENUM",
                default_value="basic",
                options=(
                    EndpointFieldOption("Basic (email + API token)", "basic"),
                    EndpointFieldOption("Personal access token", "pat"),
                    EndpointFieldOption("OAuth 2.0 client", "oauth"),
                ),
            ),
            EndpointFieldDescriptor(
                key="username",
                label="Username / Email",
                value_type="STRING",
                required=False,
                semantic="USERNAME",
                visible_when={"auth_type": ("basic",)},
                description="Jira account email used with basic authentication.",
            ),
            EndpointFieldDescriptor(
                key="api_token",
                label="API token / Password",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                visible_when={"auth_type": ("basic", "pat")},
                description="API token (for basic) or personal access token.",
            ),
            EndpointFieldDescriptor(
                key="oauth_client_id",
                label="OAuth client id",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"auth_type": ("oauth",)},
                description="OAuth client id registered for Jira.",
            ),
            EndpointFieldDescriptor(
                key="oauth_client_secret",
                label="OAuth client secret",
                value_type="PASSWORD",
                required=False,
                advanced=True,
                sensitive=True,
                visible_when={"auth_type": ("oauth",)},
                description="OAuth client secret registered for Jira.",
            ),
            EndpointFieldDescriptor(
                key="project_keys",
                label="Project keys",
                value_type="STRING",
                required=False,
                placeholder="ENG,OPS",
                description="Optional comma-separated Jira project keys to limit ingestion scope.",
            ),
            EndpointFieldDescriptor(
                key="jql_filter",
                label="JQL filter",
                value_type="STRING",
                required=False,
                advanced=True,
                description="Optional JQL appended to issue ingestion requests (e.g., statusCategory = 'In Progress').",
            ),
        )

    @classmethod
    def descriptor_capabilities(cls):
        return (
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Semantic metadata",
                description="Exposes semantic datasets (projects/issues/users) via metadata subsystem.",
            ),
            EndpointCapabilityDescriptor(
                key="ingest.incremental",
                label="Incremental ingestion",
                description="Supports updated-since pagination for issues.",
            ),
            EndpointCapabilityDescriptor(
                key="ingest.full",
                label="Full ingestion",
                description="Projects can be re-synced in full when needed.",
            ),
        )

    # --- SourceEndpoint protocol -------------------------------------------------
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
        elif _JiraMetadataSubsystem:
            self.metadata_access = _JiraMetadataSubsystem(self)
        else:
            self.metadata_access = None
        self.emitter = emitter
        self._caps = EndpointCapabilities(
            supports_full=True,
            supports_incremental=True,
            supports_metadata=bool(self.metadata_access),
        )

    def configure(self, table_cfg: Dict[str, Any]) -> None:  # pragma: no cover
        self.table_cfg.update(table_cfg)

    def capabilities(self) -> EndpointCapabilities:
        return self._caps

    def describe(self) -> Dict[str, Any]:
        return {
            "base_url": self.endpoint_cfg.get("base_url"),
            "project_keys": self.endpoint_cfg.get("project_keys"),
            "auth_type": self.endpoint_cfg.get("auth_type", "basic"),
        }

    def read_full(self) -> Any:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def read_slice(self, *, lower: str, upper: str | None) -> Any:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def count_between(self, *, lower: str, upper: str | None) -> int:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def metadata_subsystem(self) -> MetadataSubsystem | None:
        return self.metadata_access

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        units: List[EndpointUnitDescriptor] = []
        for dataset_id, definition in JIRA_DATASET_DEFINITIONS.items():
            ingestion_meta = definition.get("ingestion")
            if not ingestion_meta or not ingestion_meta.get("enabled", True):
                continue
            unit_id = ingestion_meta.get("unit_id") or dataset_id
            display_name = ingestion_meta.get("display_name") or definition.get("name") or unit_id
            description = ingestion_meta.get("description") or definition.get("description")
            scope = ingestion_meta.get("scope")
            supports_incremental = bool(ingestion_meta.get("supports_incremental"))
            default_policy = ingestion_meta.get("default_policy")
            units.append(
                EndpointUnitDescriptor(
                    unit_id=unit_id,
                    kind="dataset",
                    display_name=display_name,
                    description=description,
                    scope=scope,
                    supports_incremental=supports_incremental,
                    default_policy=default_policy,
                )
            )
        return units


@dataclass
class JiraIngestionResult:
    records: List[Dict[str, Any]]
    cursor: Dict[str, Any]
    stats: Dict[str, Any]


def run_jira_ingestion_unit(
    unit_id: str,
    *,
    endpoint_id: str,
    policy: Dict[str, Any],
    checkpoint: Optional[Dict[str, Any]] = None,
) -> JiraIngestionResult:
    definition = JIRA_DATASET_DEFINITIONS.get(unit_id)
    ingestion_meta = definition.get("ingestion") if definition else None
    if not ingestion_meta:
        raise ValueError(f"Unsupported Jira ingestion unit: {unit_id}")
    handler_key = ingestion_meta.get("handler") or unit_id
    handler = JIRA_INGESTION_HANDLERS.get(handler_key)
    if not handler:
        raise ValueError(f"No ingestion handler registered for Jira unit '{unit_id}'")
    params = _normalize_jira_parameters(policy)
    base_url = params.get("base_url")
    if not base_url:
        raise ValueError("Jira base_url is required")
    host = urlparse(base_url).hostname or "jira.local"
    org_id = params.get("scope_org_id") or "dev"
    scope_project = params.get("scope_project_id")
    cursor = _extract_jira_cursor(checkpoint)
    session = _build_jira_session(params)
    try:
        records, new_cursor, stats = handler(
            session=session,
            base_url=base_url,
            host=host,
            org_id=org_id,
            scope_project=scope_project,
            endpoint_id=endpoint_id,
            params=params,
            cursor=cursor,
        )
    finally:
        session.close()
    stats.setdefault("unitId", unit_id)
    stats.setdefault("recordCount", len(records))
    return JiraIngestionResult(records=records, cursor=new_cursor, stats=stats)


def _build_static_api_overview() -> List[Dict[str, Any]]:
    overview: List[Dict[str, Any]] = []
    for key, entry in JIRA_API_LIBRARY.items():
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


def _build_static_unit_overview() -> List[Dict[str, Any]]:
    units: List[Dict[str, Any]] = []
    for dataset_id, definition in JIRA_DATASET_DEFINITIONS.items():
        ingestion_meta = definition.get("ingestion")
        if not ingestion_meta or not ingestion_meta.get("enabled", True):
            continue
        unit_id = ingestion_meta.get("unit_id") or dataset_id
        units.append(
            {
                "unitId": unit_id,
                "datasetId": dataset_id,
                "kind": ingestion_meta.get("kind", "dataset"),
                "displayName": ingestion_meta.get("display_name") or definition.get("name") or unit_id,
                "description": ingestion_meta.get("description") or definition.get("description"),
                "supportsIncremental": bool(ingestion_meta.get("supports_incremental")),
                "defaultPolicy": ingestion_meta.get("default_policy"),
                "scope": ingestion_meta.get("scope"),
            }
        )
    return units



# --- Internal helpers -------------------------------------------------------

def _normalize_jira_parameters(policy: Dict[str, Any]) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    if isinstance(policy, dict):
        raw_params = policy.get("parameters")
        if isinstance(raw_params, dict):
            params.update(raw_params)
        for key in ("base_url", "baseUrl"):
            if policy.get(key):
                params.setdefault("base_url", policy.get(key))
        if policy.get("projectKeys") or policy.get("project_keys"):
            params.setdefault("project_keys", policy.get("projectKeys") or policy.get("project_keys"))
        if policy.get("scope_project_id") or policy.get("scopeProjectId"):
            params.setdefault("scope_project_id", policy.get("scope_project_id") or policy.get("scopeProjectId"))
        if policy.get("scope_org_id"):
            params.setdefault("scope_org_id", policy.get("scope_org_id"))
        if policy.get("users"):
            params.setdefault("users", policy.get("users"))
        if policy.get("jql_filter") or policy.get("jqlFilter"):
            params.setdefault("jql_filter", policy.get("jql_filter") or policy.get("jqlFilter"))
        if policy.get("auth_type"):
            params.setdefault("auth_type", policy.get("auth_type"))
        if policy.get("username"):
            params.setdefault("username", policy.get("username"))
        if policy.get("api_token") or policy.get("password"):
            params.setdefault("api_token", policy.get("api_token") or policy.get("password"))
    params["project_keys"] = _normalize_project_keys(params.get("project_keys"))
    params["users"] = _normalize_users(params.get("users"))
    params.setdefault("scope_org_id", "dev")
    params["auth_type"] = str(params.get("auth_type") or "basic").lower()
    return params


def _normalize_project_keys(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw_list = raw.split(",")
    elif isinstance(raw, list):
        raw_list = raw
    else:
        return []
    return [str(entry).strip().upper() for entry in raw_list if str(entry).strip()]


def _normalize_users(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw.strip()] if raw.strip() else []
    if isinstance(raw, list):
        return [str(entry).strip() for entry in raw if str(entry).strip()]
    return []


def _extract_jira_cursor(checkpoint: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not checkpoint:
        return {}
    if isinstance(checkpoint, dict):
        value = checkpoint.get("cursor")
        if isinstance(value, dict):
            return value
        return checkpoint
    return {}


def _build_jira_session(params: Dict[str, Any]) -> requests.Session:
    auth_type = params.get("auth_type")
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})
    if auth_type == "basic":
        username = params.get("username")
        token = params.get("api_token")
        if not username or not token:
            raise ValueError("Jira username and api_token required for basic auth")
        session.auth = HTTPBasicAuth(str(username), str(token))
    elif auth_type == "pat":
        token = params.get("api_token")
        if not token:
            raise ValueError("Jira API token required for PAT auth")
        session.headers["Authorization"] = f"Bearer {token}"
    else:
        raise ValueError(f"Unsupported Jira auth_type: {auth_type}")
    return session


def _jira_get(session: requests.Session, base_url: str, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{base_url.rstrip('/')}{path}"
    response = session.get(url, params=params, timeout=30)
    if response.status_code >= 400:
        snippet = response.text[:200]
        raise RuntimeError(f"Jira API call failed ({response.status_code}): {snippet}")
    return response.json()


def _sync_jira_projects(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    keys = params.get("project_keys") or []
    key_filter = set(keys) if keys else None
    records: List[Dict[str, Any]] = []
    start_at = 0
    page_size = 50
    while start_at < 1000:
        payload = _jira_get(session, base_url, "/rest/api/3/project/search", {"startAt": start_at, "maxResults": page_size, "expand": "lead"})
        projects = payload.get("values") or payload.get("projects") or []
        if not projects:
            break
        for project in projects:
            key = str(project.get("key") or "").upper()
            if key_filter and key not in key_filter:
                continue
            scope_value = scope_project or key or None
            record = _build_normalized_record(
                entity_type="work.project",
                logical_id=f"jira::{host}::project::{key}",
                display_name=project.get("name") or key,
                scope_org=org_id,
                scope_project=scope_value,
                endpoint_id=endpoint_id,
                payload=_build_project_payload(project, base_url),
            )
            records.append(record)
        start_at += len(projects)
        if len(projects) < page_size:
            break
        if len(records) >= 500:
            break
    return records, {"projectsSynced": len(records)}


def _sync_jira_issues(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    since: Optional[str],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    jql_parts: List[str] = []
    keys = params.get("project_keys") or []
    if keys:
        jql_parts.append(f"project in ({','.join(keys)})")
    if params.get("jql_filter"):
        jql_parts.append(f"({params['jql_filter']})")
    if since:
        jql_parts.append(f'updated >= "{_format_timestamp(since)}"')
    jql = " AND ".join(part for part in jql_parts if part)
    records: List[Dict[str, Any]] = []
    latest = since
    start_at = 0
    page_size = 50
    while start_at < 2000:
        payload = _jira_get(
            session,
            base_url,
            "/rest/api/3/search",
            {
                "jql": jql,
                "startAt": start_at,
                "maxResults": page_size,
                "fields": "summary,updated,status,assignee,reporter,project",
            },
        )
        issues = payload.get("issues", [])
        if not issues:
            break
        for issue in issues:
            record = _build_issue_record(issue, base_url, host, org_id, scope_project, endpoint_id)
            records.append(record)
            updated = issue.get("fields", {}).get("updated")
            if updated and _is_after(updated, latest):
                latest = updated
        start_at += len(issues)
        if len(issues) < page_size:
            break
        if len(records) >= 500:
            break
    return records, latest


def _sync_jira_users(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    start_at = 0
    page_size = 50
    while start_at < 500:
        payload = _jira_get(
            session,
            base_url,
            "/rest/api/3/users/search",
            {"startAt": start_at, "maxResults": page_size, "query": params.get("user_query") or ""},
        )
        if not payload:
            break
        for user in payload:
            account_id = user.get("accountId")
            if not account_id:
                continue
            record = _build_normalized_record(
                entity_type="person.user",
                logical_id=f"jira::{host}::user::{account_id}",
                display_name=user.get("displayName") or account_id,
                scope_org=org_id,
                scope_project=scope_project,
                endpoint_id=endpoint_id,
                payload=_build_user_payload(user, base_url),
            )
            records.append(record)
        if len(payload) < page_size:
            break
        if len(records) >= 200:
            break
        start_at += len(payload)
    return records, {"usersSynced": len(records)}


def _format_timestamp(value: str) -> str:
    try:
        parsed = _parse_datetime(value)
        return parsed.strftime("%Y/%m/%d %H:%M")
    except Exception:
        return value


def _parse_datetime(value: str) -> datetime:
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _is_after(candidate: Optional[str], current: Optional[str]) -> bool:
    if not candidate:
        return False
    if not current:
        return True
    try:
        return _parse_datetime(candidate) > _parse_datetime(current)
    except Exception:
        return candidate > current
def _build_normalized_record(
    *,
    entity_type: str,
    logical_id: str,
    display_name: str,
    scope_org: str,
    scope_project: Optional[str],
    endpoint_id: str,
    payload: Dict[str, Any],
    vendor: str = "jira",
    phase: Optional[str] = None,
    edges: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "entityType": entity_type,
        "logicalId": logical_id,
        "displayName": display_name,
        "scope": {
            "orgId": scope_org,
            "projectId": scope_project,
            "domainId": None,
            "teamId": None,
        },
        "provenance": {
            "endpointId": endpoint_id,
            "vendor": vendor,
        },
        "payload": payload,
    }
    if phase:
        record["phase"] = phase
    if edges:
        record["edges"] = edges
    return record


def _build_project_payload(project: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    key = project.get("key")
    return {
        "key": key,
        "name": project.get("name"),
        "projectType": project.get("projectTypeKey"),
        "lead": _extract_account(project.get("lead")),
        "url": f"{base_url.rstrip('/')}/browse/{key}" if key else base_url,
        "raw": project,
    }


def _build_issue_record(
    issue: Dict[str, Any],
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
) -> Dict[str, Any]:
    key = issue.get("key") or issue.get("id")
    fields = issue.get("fields") or {}
    project = fields.get("project") or {}
    scope_value = scope_project or project.get("key") or None
    payload = _build_issue_payload(issue, base_url)
    return _build_normalized_record(
        entity_type="work.item",
        logical_id=f"jira::{host}::issue::{key}",
        display_name=fields.get("summary") or key,
        scope_org=org_id,
        scope_project=scope_value,
        endpoint_id=endpoint_id,
        payload=payload,
    )


def _build_issue_payload(issue: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    fields = issue.get("fields") or {}
    status = fields.get("status") or {}
    key = issue.get("key")
    return {
        "key": key,
        "summary": fields.get("summary"),
        "status": status.get("name"),
        "statusCategory": (status.get("statusCategory") or {}).get("key"),
        "project": fields.get("project"),
        "updated": fields.get("updated"),
        "url": f"{base_url.rstrip('/')}/browse/{key}" if key else base_url,
        "assignee": _extract_account(fields.get("assignee")),
        "reporter": _extract_account(fields.get("reporter")),
        "raw": issue,
    }


def _build_user_payload(user: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    return {
        "accountId": user.get("accountId"),
        "displayName": user.get("displayName"),
        "email": user.get("emailAddress"),
        "timeZone": user.get("timeZone"),
        "active": user.get("active"),
        "avatar": user.get("avatarUrls"),
        "profileUrl": f"{base_url.rstrip('/')}/people/{user.get('accountId')}" if user.get("accountId") else None,
        "raw": user,
    }


def _extract_account(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not user or not isinstance(user, dict):
        return None
    return {
        "accountId": user.get("accountId"),
        "displayName": user.get("displayName"),
        "email": user.get("emailAddress"),
    }


def _run_projects_unit(
    *,
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    cursor: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    records, stats = _sync_jira_projects(session, base_url, host, org_id, scope_project, endpoint_id, params)
    new_cursor = {"lastRunAt": datetime.now().isoformat()}
    return records, new_cursor, stats


def _run_issues_unit(
    *,
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    cursor: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    since = cursor.get("lastUpdated")
    records, latest = _sync_jira_issues(
        session,
        base_url,
        host,
        org_id,
        scope_project,
        endpoint_id,
        params,
        since,
    )
    new_cursor = {"lastUpdated": latest or since}
    stats = {"lastUpdated": latest or since, "issuesSynced": len(records)}
    return records, new_cursor, stats


def _run_users_unit(
    *,
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    cursor: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    records, stats = _sync_jira_users(session, base_url, host, org_id, scope_project, endpoint_id, params)
    new_cursor = {"lastRunAt": datetime.now().isoformat()}
    return records, new_cursor, stats


JIRA_INGESTION_HANDLERS: Dict[str, Any] = {
    "projects": _run_projects_unit,
    "issues": _run_issues_unit,
    "users": _run_users_unit,
}
