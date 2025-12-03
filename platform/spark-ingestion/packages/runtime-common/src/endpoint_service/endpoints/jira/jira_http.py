from __future__ import annotations

import os
import random
import time
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from requests.auth import HTTPBasicAuth

from ingestion_models.endpoints import (
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionTemplate,
    EndpointConnectionResult,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointProbingPlan,
    EndpointTestResult,
    EndpointUnitDescriptor,
    IngestionCapableEndpoint,
    SupportsIngestionExecution,
    SupportsPreview,
    MetadataSubsystem,
)
from .jira_catalog import JIRA_API_LIBRARY, JIRA_DATASET_DEFINITIONS

MAX_JIRA_RECORDS_PER_RUN = max(1, int(os.environ.get("JIRA_MAX_RECORDS_PER_RUN", "500")))
RATE_LIMIT_STATUSES = {429, 500, 502, 503, 504}
JIRA_MAX_API_RETRIES = max(1, int(os.environ.get("JIRA_MAX_API_RETRIES", "5")))
JIRA_RATE_LIMIT_FALLBACK_DELAY = max(1.0, float(os.environ.get("JIRA_RATE_LIMIT_DELAY_SECONDS", "5")))

logger = logging.getLogger(__name__)

class JiraEndpoint(IngestionCapableEndpoint, SupportsIngestionExecution, SupportsPreview):
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
                key="preview",
                label="Dataset preview",
                description="Supports lightweight dataset previews via Jira REST APIs.",
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

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = _normalize_jira_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        base_url = normalized.get("base_url")
        if not base_url:
            raise ValueError("Jira base_url is required.")
        descriptor = cls.descriptor()
        config = {
            "templateId": cls.TEMPLATE_ID,
            "parameters": normalized,
        }
        return EndpointConnectionResult(
            url=base_url.rstrip("/"),
            config=config,
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=descriptor.connection.default_verb if descriptor.connection else None,
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = _normalize_jira_parameters(parameters)
        base_url = normalized.get("base_url")
        if not base_url:
            return EndpointTestResult(success=False, message="Base URL is required.")
        try:
            session = _build_jira_session(normalized)
        except Exception as exc:  # pragma: no cover - runtime validation
            return EndpointTestResult(success=False, message=str(exc))
        try:
            server_info = _jira_get(session, base_url, "/rest/api/3/serverInfo") or {}
            user_info = _jira_get(session, base_url, "/rest/api/3/myself") or {}
        except Exception as exc:
            session.close()
            return EndpointTestResult(success=False, message=str(exc))
        finally:
            try:
                session.close()
            except Exception:  # pragma: no cover - defensive
                pass
        detected_version = server_info.get("version")
        capabilities = tuple(capability.key for capability in cls.descriptor_capabilities())
        details = {
            "deploymentType": server_info.get("deploymentType"),
            "authenticatedUser": {
                "accountId": user_info.get("accountId"),
                "displayName": user_info.get("displayName"),
                "emailAddress": user_info.get("emailAddress"),
            },
        }
        return EndpointTestResult(success=True, message="Connection successful.", detected_version=detected_version, capabilities=capabilities, details=details)

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
        else:
            from endpoint_service.endpoints.jira.metadata import JiraMetadataSubsystem
            self.metadata_access = JiraMetadataSubsystem(self)  # type: ignore[call-arg]
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
            "base_url": self.endpoint_cfg.get("base_url"),
            "project_keys": self.endpoint_cfg.get("project_keys"),
            "auth_type": self.endpoint_cfg.get("auth_type", "basic"),
            "incremental_column": "updated",
        }

    def read_full(self) -> Any:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def read_slice(self, *, lower: str, upper: str | None) -> Any:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def count_between(self, *, lower: str, upper: str | None) -> int:  # pragma: no cover - not implemented yet
        raise NotImplementedError("JiraEndpoint runtime export has not been implemented. Use ingestion workflows.")

    def metadata_subsystem(self) -> MetadataSubsystem:
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
            incr_col = ingestion_meta.get("incremental_column") or "updated"
            incr_lit = ingestion_meta.get("incremental_literal") or "timestamp"
            default_policy = ingestion_meta.get("default_policy")
            cdm_model_id = ingestion_meta.get("cdm_model_id")
            units.append(
                EndpointUnitDescriptor(
                    unit_id=unit_id,
                    kind="dataset",
                    display_name=display_name,
                    description=description,
                    scope=scope,
                    supports_incremental=supports_incremental,
                    ingestion_strategy="scd1" if supports_incremental else "full",
                    incremental_column=incr_col if supports_incremental else None,
                    incremental_literal=incr_lit if supports_incremental else None,
                    default_policy=default_policy,
                    cdm_model_id=cdm_model_id,
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
    ) -> JiraIngestionResult:
        return run_jira_ingestion_unit(
            unit_id,
            endpoint_id=endpoint_id,
            policy=policy,
            checkpoint=checkpoint,
            mode=mode,
            filter=filter,
            transient_state=transient_state,
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
            dataset_id = unit_id or self.table_cfg.get("dataset") or self.table_cfg.get("table") or "jira.issues"
            return subsystem.preview_dataset(dataset_id=dataset_id, limit=limit, config=self.endpoint_cfg)
        raise ValueError("Preview not supported for Jira without metadata subsystem")


@dataclass
class JiraIngestionResult:
    records: List[Dict[str, Any]]
    cursor: Dict[str, Any]
    stats: Dict[str, Any]
    transient_state: Dict[str, Any]


@dataclass
class JiraIngestionFilter:
    project_keys: List[str]
    statuses: List[str]
    assignee_ids: List[str]
    updated_from: Optional[str]
    updated_to: Optional[str] = None


class JiraTransientState:
    def __init__(self, payload: Optional[Dict[str, Any]] = None) -> None:
        base: Dict[str, Any] = {}
        if isinstance(payload, dict):
            base.update(payload)
        projects = base.get("projects")
        if not isinstance(projects, dict):
            projects = {}
        normalized_projects = {}
        for key, value in projects.items():
            if not isinstance(value, dict):
                continue
            normalized_projects[str(key).upper()] = dict(value)
        base["projects"] = normalized_projects
        self._state = base

    def get_project_cursor(self, project_key: str) -> Dict[str, Any]:
        projects = self._state.setdefault("projects", {})
        return projects.get(str(project_key).upper(), {})

    def set_project_cursor(self, project_key: str, last_updated: Optional[str]) -> None:
        if not last_updated:
            return
        projects = self._state.setdefault("projects", {})
        projects[str(project_key).upper()] = {"lastUpdated": last_updated}

    def set_global_cursor(self, last_updated: Optional[str]) -> None:
        if last_updated:
            self._state["lastUpdated"] = last_updated

    def serialize(self) -> Dict[str, Any]:
        return self._state


def run_jira_ingestion_unit(
    unit_id: str,
    *,
    endpoint_id: str,
    policy: Dict[str, Any],
    checkpoint: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None,
    filter: Optional[Dict[str, Any]] = None,
    transient_state: Optional[Dict[str, Any]] = None,
) -> JiraIngestionResult:
    definition = JIRA_DATASET_DEFINITIONS.get(unit_id)
    ingestion_meta = definition.get("ingestion") if definition else None
    if not ingestion_meta:
        raise ValueError(f"Unsupported Jira ingestion unit: {unit_id}")
    handler_key = ingestion_meta.get("handler") or unit_id
    handler = JIRA_INGESTION_HANDLERS.get(handler_key)
    if not handler:
        raise ValueError(f"No ingestion handler registered for Jira unit '{unit_id}'")
    slice_bounds = {}
    if isinstance(policy, dict):
        slice_bounds = policy.get("slice") or {}
    params = _normalize_jira_parameters(policy)
    # Merge filter and slice bounds into one normalized filter
    merged_filter = dict(filter or {})
    if slice_bounds:
        if slice_bounds.get("lower"):
            merged_filter.setdefault("updated_from", slice_bounds.get("lower"))
        if slice_bounds.get("upper"):
            merged_filter.setdefault("updated_to", slice_bounds.get("upper"))
    ingestion_filter = _normalize_ingestion_filter(merged_filter)
    if ingestion_filter:
        _apply_ingestion_filter(params, ingestion_filter)
    base_url = params.get("base_url")
    if not base_url:
        raise ValueError("Jira base_url is required")
    host = urlparse(base_url).hostname or "jira.local"
    org_id = params.get("scope_org_id") or "dev"
    scope_project = params.get("scope_project_id")
    cursor = {} if str(mode or "").upper() == "FULL" else _extract_jira_cursor(checkpoint)
    state = JiraTransientState(transient_state)
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
            ingestion_filter=ingestion_filter,
            state=state,
        )
    finally:
        session.close()
    stats.setdefault("unitId", unit_id)
    if str(mode or "").upper() == "PREVIEW":
        max_rows = policy.get("limit") if isinstance(policy, dict) else None
        if isinstance(max_rows, int) and max_rows > 0:
            records = records[:max_rows]
    stats.setdefault("recordCount", len(records))
    return JiraIngestionResult(records=records, cursor=new_cursor, stats=stats, transient_state=state.serialize())


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
                "cdmModelId": ingestion_meta.get("cdm_model_id"),
            }
        )
    return units


def _build_issue_jql(params: Dict[str, Any], since: Optional[str]) -> str:
    clauses: List[str] = []
    keys = params.get("project_keys") or []
    if keys:
        clauses.append(f"project in ({','.join(_quote_jql_value(key) for key in keys)})")
    jql_filter = params.get("jql_filter")
    if jql_filter:
        clauses.append(f"({jql_filter})")
    statuses = params.get("filter_statuses") or []
    if statuses:
        clauses.append(f"status in ({','.join(_quote_jql_value(status) for status in statuses)})")
    assignee_ids = params.get("filter_assignee_ids") or []
    if assignee_ids:
        clauses.append(f"assignee in ({','.join(_quote_jql_value(assignee) for assignee in assignee_ids)})")
    updated_from = since or params.get("filter_updated_from")
    if updated_from:
        clauses.append(f'updated >= "{_format_timestamp(updated_from)}"')
    updated_to = params.get("filter_updated_to")
    if updated_to:
        clauses.append(f'updated < "{_format_timestamp(updated_to)}"')
    return " AND ".join(clauses)


def _quote_jql_value(value: str) -> str:
    escaped = str(value).replace('"', '\\"')
    return f'"{escaped}"'


def _iter_issue_search(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    since: Optional[str],
    fields: str,
    max_records: int = 2000,
    page_size: int = 200,
) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    jql = _build_issue_jql(params, since)
    page_token: Optional[str] = None
    fetched = 0
    page_size = max(1, min(page_size, max_records)) if max_records else page_size
    effective_max = max_records or 2000
    while fetched < effective_max:
        query: Dict[str, Any] = {
            "jql": jql,
            "maxResults": min(page_size, effective_max - fetched),
            "fields": fields,
        }
        if page_token:
            query["pageToken"] = page_token
        payload = _jira_get(
            session,
            base_url,
            "/rest/api/3/search/jql",
            query,
        )
        issues = payload.get("issues", [])
        if not issues:
            break
        results.extend(issues)
        fetched += len(issues)
        page_token = payload.get("nextPageToken")
        if not page_token or payload.get("isLast"):
            break
    return results


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
        max_records_value = policy.get("max_records") or policy.get("maxRecords")
        if max_records_value is not None:
            params.setdefault("max_records", max_records_value)
        # Respect explicit preview/ingestion limits by mapping to max_records so handlers
        # do not over-fetch beyond the requested sample size.
        if policy.get("limit") is not None and "max_records" not in params:
            params["max_records"] = policy.get("limit")
    params["project_keys"] = _normalize_project_keys(params.get("project_keys"))
    params["users"] = _normalize_users(params.get("users"))
    params.setdefault("scope_org_id", "dev")
    params["auth_type"] = str(params.get("auth_type") or "basic").lower()
    return params


def _resolve_max_records(params: Dict[str, Any], fallback: int) -> int:
    candidate = params.get("max_records")
    value = fallback
    if isinstance(candidate, (int, float)):
        value = int(candidate)
    elif isinstance(candidate, str) and candidate.strip():
        try:
            value = int(float(candidate.strip()))
        except ValueError:
            value = fallback
    value = max(1, value)
    if MAX_JIRA_RECORDS_PER_RUN:
        value = min(value, MAX_JIRA_RECORDS_PER_RUN)
    return value


def _normalize_ingestion_filter(raw: Optional[Dict[str, Any]]) -> Optional[JiraIngestionFilter]:
    if not raw or not isinstance(raw, dict):
        return None
    project_keys = _normalize_project_keys(raw.get("projectKeys") or raw.get("project_keys"))
    statuses = _normalize_filter_values(raw.get("statuses"))
    assignee_ids = _normalize_filter_values(raw.get("assigneeIds") or raw.get("assignees"))
    updated_from = _normalize_timestamp_value(raw.get("updatedFrom") or raw.get("updated_from"))
    updated_to = _normalize_timestamp_value(raw.get("updatedTo") or raw.get("updated_to"))
    if not project_keys and not statuses and not assignee_ids and not updated_from and not updated_to:
        return None
    return JiraIngestionFilter(
        project_keys=project_keys,
        statuses=statuses,
        assignee_ids=assignee_ids,
        updated_from=updated_from,
        updated_to=updated_to,
    )


def _apply_ingestion_filter(params: Dict[str, Any], ingestion_filter: JiraIngestionFilter) -> None:
    if ingestion_filter.project_keys:
        params["project_keys"] = ingestion_filter.project_keys
    if ingestion_filter.statuses:
        params["filter_statuses"] = ingestion_filter.statuses
    if ingestion_filter.assignee_ids:
        params["filter_assignee_ids"] = ingestion_filter.assignee_ids
    if ingestion_filter.updated_from:
        params["filter_updated_from"] = ingestion_filter.updated_from
    if ingestion_filter.updated_to:
        params["filter_updated_to"] = ingestion_filter.updated_to


def _normalize_filter_values(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw_list = raw.split(",")
    elif isinstance(raw, list):
        raw_list = raw
    else:
        return []
    values = []
    for entry in raw_list:
        entry_str = str(entry).strip()
        if entry_str:
            values.append(entry_str)
    return values


def _normalize_timestamp_value(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, str):
        candidate = value.strip()
        try:
            parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            return parsed.isoformat()
        except ValueError:
            return candidate
    if isinstance(value, datetime):
        return value.isoformat()
    return None


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
    attempt = 0
    delay = JIRA_RATE_LIMIT_FALLBACK_DELAY
    while True:
        response = session.get(url, params=params, timeout=30)
        if response.status_code < 400:
            return response.json()
        snippet = response.text[:200]
        attempt += 1
        if response.status_code in RATE_LIMIT_STATUSES and attempt < JIRA_MAX_API_RETRIES:
            retry_after_header = response.headers.get("Retry-After")
            wait_seconds: float = delay * attempt
            if retry_after_header:
                try:
                    wait_seconds = float(retry_after_header)
                except ValueError:
                    wait_seconds = delay * attempt
            jitter = random.uniform(0.0, 0.5)
            total_sleep = max(wait_seconds + jitter, 1.0)
            logger.warning(
                "jira_api_rate_limited",
                extra={
                    "url": url,
                    "status": response.status_code,
                    "attempt": attempt,
                    "sleepSeconds": round(total_sleep, 2),
                },
            )
            time.sleep(total_sleep)
            continue
        raise RuntimeError(f"Jira API call failed ({response.status_code}): {snippet}")


def _sync_jira_projects(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    max_records: int = 500,
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
        if len(records) >= max_records:
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
    max_records: int = 500,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    records: List[Dict[str, Any]] = []
    latest = since
    issues = _iter_issue_search(
        session,
        base_url,
        params,
        since,
        fields="summary,updated,status,assignee,reporter,project",
        max_records=max_records,
    )
    for issue in issues:
        record = _build_issue_record(issue, base_url, host, org_id, scope_project, endpoint_id)
        records.append(record)
        updated = issue.get("fields", {}).get("updated")
        if updated and _is_after(updated, latest):
            latest = updated
        if len(records) >= max_records:
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
    max_records: int = 500,
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
        if len(records) >= max_records:
            break
        start_at += len(payload)
    return records, {"usersSynced": len(records)}


def _sync_jira_comments(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    since: Optional[str],
    max_records: int = 500,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    records: List[Dict[str, Any]] = []
    latest = since
    issues = _iter_issue_search(session, base_url, params, since, fields="project,updated", max_records=max_records)
    page_size = 50
    for issue in issues:
        issue_key = issue.get("key") or issue.get("id")
        if not issue_key:
            continue
        start_at = 0
        while start_at < 1000:
            payload = _jira_get(
                session,
                base_url,
                f"/rest/api/3/issue/{issue_key}/comment",
                {"startAt": start_at, "maxResults": page_size},
            )
            comments = payload.get("comments") or []
            if not comments:
                break
            for comment in comments:
                updated = comment.get("updated") or comment.get("created")
                if since and updated and not _is_after(updated, since):
                    continue
                record = _build_comment_record(
                    comment,
                    issue,
                    base_url,
                    host,
                    org_id,
                    scope_project,
                    endpoint_id,
                )
                records.append(record)
                if updated and _is_after(updated, latest):
                    latest = updated
                if len(records) >= max_records:
                    return records, latest
            start_at += len(comments)
            if len(comments) < page_size:
                break
        if len(records) >= max_records:
            break
    return records, latest


def _sync_jira_worklogs(
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    since: Optional[str],
    max_records: int = 500,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    records: List[Dict[str, Any]] = []
    latest = since
    issues = _iter_issue_search(session, base_url, params, since, fields="project,updated", max_records=max_records)
    page_size = 50
    for issue in issues:
        issue_key = issue.get("key") or issue.get("id")
        if not issue_key:
            continue
        start_at = 0
        while start_at < 1000:
            payload = _jira_get(
                session,
                base_url,
                f"/rest/api/3/issue/{issue_key}/worklog",
                {"startAt": start_at, "maxResults": page_size},
            )
            worklogs = payload.get("worklogs") or []
            if not worklogs:
                break
            for worklog in worklogs:
                started = worklog.get("started") or worklog.get("updated")
                if since and started and not _is_after(started, since):
                    continue
                record = _build_worklog_record(
                    worklog,
                    issue,
                    base_url,
                    host,
                    org_id,
                    scope_project,
                    endpoint_id,
                )
                records.append(record)
                if started and _is_after(started, latest):
                    latest = started
                if len(records) >= max_records:
                    return records, latest
            start_at += len(worklogs)
            if len(worklogs) < page_size:
                break
        if len(records) >= max_records:
            break
    return records, latest


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


def _build_comment_record(
    comment: Dict[str, Any],
    issue: Dict[str, Any],
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
) -> Dict[str, Any]:
    issue_key = issue.get("key") or issue.get("id")
    project = (issue.get("fields") or {}).get("project") or {}
    scope_value = scope_project or project.get("key") or None
    payload = _build_comment_payload(comment, issue_key, base_url)
    edges = [{"type": "ANNOTATES", "target": f"jira::{host}::issue::{issue_key}"}] if issue_key else None
    return _build_normalized_record(
        entity_type="work.comment",
        logical_id=f"jira::{host}::comment::{comment.get('id') or comment.get('commentId')}",
        display_name=f"Comment on {issue_key}",
        scope_org=org_id,
        scope_project=scope_value,
        endpoint_id=endpoint_id,
        payload=payload,
        edges=edges,
    )


def _build_comment_payload(comment: Dict[str, Any], issue_key: Optional[str], base_url: str) -> Dict[str, Any]:
    return {
        "id": comment.get("id"),
        "issueKey": issue_key,
        "body": comment.get("body"),
        "created": comment.get("created"),
        "updated": comment.get("updated"),
        "author": _extract_account(comment.get("author")),
        "url": f"{base_url.rstrip('/')}/browse/{issue_key}" if issue_key else base_url,
        "raw": comment,
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


def _build_worklog_record(
    worklog: Dict[str, Any],
    issue: Dict[str, Any],
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
) -> Dict[str, Any]:
    issue_key = issue.get("key") or issue.get("id")
    project = (issue.get("fields") or {}).get("project") or {}
    scope_value = scope_project or project.get("key") or None
    payload = _build_worklog_payload(worklog, issue_key, base_url)
    edges = [{"type": "TRACKS", "target": f"jira::{host}::issue::{issue_key}"}] if issue_key else None
    return _build_normalized_record(
        entity_type="work.worklog",
        logical_id=f"jira::{host}::worklog::{worklog.get('id') or worklog.get('worklogId')}",
        display_name=f"Worklog for {issue_key}",
        scope_org=org_id,
        scope_project=scope_value,
        endpoint_id=endpoint_id,
        payload=payload,
        edges=edges,
    )


def _build_worklog_payload(worklog: Dict[str, Any], issue_key: Optional[str], base_url: str) -> Dict[str, Any]:
    return {
        "id": worklog.get("id"),
        "issueKey": issue_key,
        "timeSpentSeconds": worklog.get("timeSpentSeconds"),
        "started": worklog.get("started"),
        "updated": worklog.get("updated"),
        "author": _extract_account(worklog.get("author")),
        "url": f"{base_url.rstrip('/')}/browse/{issue_key}" if issue_key else base_url,
        "raw": worklog,
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
    ingestion_filter: Optional[JiraIngestionFilter] = None,
    state: Optional[JiraTransientState] = None,
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
    ingestion_filter: Optional[JiraIngestionFilter] = None,
    state: Optional[JiraTransientState] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    state = state or JiraTransientState()
    records: List[Dict[str, Any]] = []
    new_cursor: Dict[str, Any] = {}
    max_records = _resolve_max_records(params, 500)
    if "lastUpdated" in cursor:
        new_cursor["lastUpdated"] = cursor.get("lastUpdated")
    project_cursors = cursor.get("projects") if isinstance(cursor.get("projects"), dict) else {}
    updated_projects: Dict[str, Dict[str, Any]] = dict(project_cursors or {})
    project_keys = []
    if ingestion_filter and ingestion_filter.project_keys:
        project_keys = ingestion_filter.project_keys
    elif params.get("project_keys"):
        project_keys = params.get("project_keys") or []
    project_keys = [key for key in project_keys if key]
    projects = project_keys or [None]
    for project_key in projects:
        scoped_params = dict(params)
        if project_key:
            scoped_params["project_keys"] = [project_key]
        since = None
        if project_key:
            since = state.get_project_cursor(project_key).get("lastUpdated")
            if not since and isinstance(project_cursors, dict):
                project_state = project_cursors.get(project_key) or project_cursors.get(str(project_key).upper())
                if isinstance(project_state, dict):
                    since = project_state.get("lastUpdated")
            if not since and ingestion_filter and ingestion_filter.updated_from:
                since = ingestion_filter.updated_from
        else:
            since = state.serialize().get("lastUpdated") or cursor.get("lastUpdated") or (
                ingestion_filter.updated_from if ingestion_filter else None
            )
        project_records, latest = _sync_jira_issues(
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            scoped_params,
            since,
            max_records=max_records,
        )
        records.extend(project_records)
        latest_value = latest or since
        if project_key:
            if latest_value:
                state.set_project_cursor(project_key, latest_value)
                updated_projects[str(project_key).upper()] = {"lastUpdated": latest_value}
        else:
            if latest_value:
                state.set_global_cursor(latest_value)
                new_cursor["lastUpdated"] = latest_value
    if updated_projects:
        new_cursor["projects"] = updated_projects
    stats = {"lastUpdated": new_cursor.get("lastUpdated"), "issuesSynced": len(records)}
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
    ingestion_filter: Optional[JiraIngestionFilter] = None,
    state: Optional[JiraTransientState] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    records, stats = _sync_jira_users(session, base_url, host, org_id, scope_project, endpoint_id, params)
    new_cursor = {"lastRunAt": datetime.now().isoformat()}
    return records, new_cursor, stats


def _run_comments_unit(
    *,
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    cursor: Dict[str, Any],
    ingestion_filter: Optional[JiraIngestionFilter] = None,
    state: Optional[JiraTransientState] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    since = cursor.get("lastUpdated")
    max_records = _resolve_max_records(params, 500)
    records, latest = _sync_jira_comments(
        session,
        base_url,
        host,
        org_id,
        scope_project,
        endpoint_id,
        params,
        since,
        max_records=max_records,
    )
    new_cursor = {"lastUpdated": latest or since}
    stats = {"commentsSynced": len(records), "lastUpdated": new_cursor["lastUpdated"]}
    return records, new_cursor, stats


def _run_worklogs_unit(
    *,
    session: requests.Session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    cursor: Dict[str, Any],
    ingestion_filter: Optional[JiraIngestionFilter] = None,
    state: Optional[JiraTransientState] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    since = cursor.get("lastStarted")
    max_records = _resolve_max_records(params, 500)
    records, latest = _sync_jira_worklogs(
        session,
        base_url,
        host,
        org_id,
        scope_project,
        endpoint_id,
        params,
        since,
        max_records=max_records,
    )
    new_cursor = {"lastStarted": latest or since}
    stats = {"worklogsSynced": len(records), "lastStarted": new_cursor["lastStarted"]}
    return records, new_cursor, stats


JIRA_INGESTION_HANDLERS: Dict[str, Any] = {
    "projects": _run_projects_unit,
    "issues": _run_issues_unit,
    "users": _run_users_unit,
    "comments": _run_comments_unit,
    "worklogs": _run_worklogs_unit,
}
