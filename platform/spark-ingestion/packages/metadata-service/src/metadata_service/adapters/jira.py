from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import time
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from urllib.parse import urlparse

from metadata_service.collector import MetadataJob
from metadata_service.models import CatalogSnapshot, MetadataConfigValidationResult, MetadataPlanningResult
from metadata_service.normalizers import JiraMetadataNormalizer
from metadata_service.utils import safe_upper
from runtime_core import MetadataTarget

try:  # pragma: no cover - imported dynamically inside the Temporal worker
    from runtime_common.endpoints.base import MetadataSubsystem  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback when runtime packages absent
    MetadataSubsystem = object  # type: ignore[misc,assignment]

try:  # pragma: no cover - optional dependency when running unit tests outside repo
    from runtime_common.endpoints import jira_http as jira_runtime  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    jira_runtime = None  # type: ignore

from runtime_common.endpoints.jira_catalog import JIRA_API_LIBRARY, JIRA_DATASET_DEFINITIONS

DATASET_DEFINITIONS: Dict[str, Dict[str, Any]] = JIRA_DATASET_DEFINITIONS


def _normalize_dataset_name(dataset_id: Optional[str]) -> str:
    """Convert catalog dataset identifiers into canonical Jira dataset keys."""
    candidate = (dataset_id or "").strip()
    if not candidate:
        return "jira.issues"
    if candidate in DATASET_DEFINITIONS:
        return candidate
    if candidate.startswith("dataset::"):
        parts = candidate.split("::")
        if parts:
            candidate = parts[-1]
    if candidate in DATASET_DEFINITIONS:
        return candidate
    if candidate.startswith("jira.") and candidate in DATASET_DEFINITIONS:
        return candidate
    namespace = "jira"
    remainder = candidate
    if "." in candidate:
        namespace, remainder = candidate.split(".", 1)
    elif "-" in candidate:
        namespace, remainder = candidate.split("-", 1)
    remainder = remainder.replace("-", "_")
    normalized = f"{namespace}.{remainder}" if remainder else namespace
    if normalized in DATASET_DEFINITIONS:
        return normalized
    return normalized


class JiraMetadataSubsystem(MetadataSubsystem):
    """Expose Jira metadata in a catalog-friendly format with dynamic attribute discovery."""

    def __init__(self, endpoint: "JiraEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = JiraMetadataNormalizer()

    # ------------------------------------------------------------------ MetadataSubsystem protocol --
    def capabilities(self) -> Dict[str, Any]:
        return {
            "sections": ["environment", "schema_fields", "statistics", "api_surface"],
            "datasets": sorted(DATASET_DEFINITIONS.keys()),
            "supports_incremental_ingest": True,
        }

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]:
        params = self._resolved_parameters(config)
        base_url = params.get("base_url")
        if not base_url:
            raise ValueError("Jira base_url is required to probe the environment")
        if jira_runtime is None:
            raise RuntimeError("runtime_common endpoints package is required for Jira metadata probing")

        session = jira_runtime._build_jira_session(params)  # type: ignore[attr-defined]
        try:
            server_info = jira_runtime._jira_get(session, base_url, "/rest/api/3/serverInfo")  # type: ignore[attr-defined]
            user_info = jira_runtime._jira_get(session, base_url, "/rest/api/3/myself")  # type: ignore[attr-defined]
            fields_raw = _safe_fetch(session, base_url, "/rest/api/3/field")
            statuses_raw = _safe_fetch(session, base_url, "/rest/api/3/status")
            priorities_raw = _safe_fetch(session, base_url, "/rest/api/3/priority")
            issue_types_raw = _safe_fetch(session, base_url, "/rest/api/3/issuetype")
        finally:
            session.close()

        catalog_sources = {
            "issue_fields": _simplify_issue_fields(fields_raw or []),
            "statuses": _simplify_statuses(statuses_raw or []),
            "priorities": _simplify_priorities(priorities_raw or []),
            "issue_types": _simplify_issue_types(issue_types_raw or []),
        }

        environment = {
            "dialect": "jira",
            "base_url": base_url,
            "project_keys": params.get("project_keys", []),
            "deployment_type": server_info.get("deploymentType"),
            "version": server_info.get("version"),
            "authenticated_user": {
                "accountId": user_info.get("accountId"),
                "displayName": user_info.get("displayName"),
                "email": user_info.get("emailAddress"),
            },
            "probe_time": datetime.now(timezone.utc).isoformat(),
            "catalog_sources": catalog_sources,
            "api_catalog": _build_api_catalog(params),
        }
        return environment

    def collect_snapshot(
        self,
        *,
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
        dataset_name = self._resolve_dataset_name(config)
        manifest = self._build_dataset_manifest(dataset_name, config, environment)
        datasource = self._build_datasource(environment)
        raw = {
            "datasource": datasource,
            "dataset": manifest,
        }
        return self._normalizer.normalize(
            raw=raw,
            environment=environment,
            config=config,
            endpoint_descriptor=self.endpoint.describe(),
        )

    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]:  # pragma: no cover - future use
        raise NotImplementedError("Jira ingestion is handled via the ingestion workflow pipeline.")

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        params = self._resolved_parameters(parameters or {})
        errors: List[str] = []
        base_url = params.get("base_url") or params.get("connection_url")
        if not base_url:
            errors.append("base_url is required for Jira metadata collection.")
        elif "base_url" not in params:
            params["base_url"] = base_url
        return MetadataConfigValidationResult(
            ok=not errors,
            errors=errors,
            normalized_parameters=params,
        )

    def plan_metadata_jobs(
        self,
        *,
        parameters: Dict[str, Any],
        request: Any,
        logger,
    ) -> MetadataPlanningResult:
        datasets = self.capabilities().get("datasets") or []
        if not datasets:
            logger.warn(event="metadata_no_http_datasets", endpoint=getattr(request, "endpointId", None))
            return MetadataPlanningResult(jobs=[])
        source_id = getattr(request, "sourceId", None) or getattr(request, "endpointId", None)
        project_id = getattr(request, "projectId", None)
        endpoint_cls = self.endpoint.__class__
        jobs: List[MetadataJob] = []
        for dataset_id in datasets:
            namespace, entity = _split_dataset_identifier(dataset_id)
            table_cfg = {
                "schema": namespace.lower(),
                "table": entity,
                "dataset": dataset_id,
                "mode": "full",
                "metadata_project_id": project_id,
            }
            endpoint = endpoint_cls(
                tool=None,
                endpoint_cfg=parameters,
                table_cfg=table_cfg,
            )
            target = MetadataTarget(
                source_id=source_id,
                namespace=safe_upper(namespace),
                entity=safe_upper(entity),
            )
            jobs.append(MetadataJob(target=target, artifact=table_cfg, endpoint=endpoint))
        return MetadataPlanningResult(jobs=jobs)

    def preview_dataset(
        self,
        dataset_id: str,
        *,
        limit: int = 25,
        config: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        params = self._resolved_parameters(config or {})
        base_url = params.get("base_url") or self.endpoint.endpoint_cfg.get("base_url")
        if not base_url:
            raise ValueError("Jira base_url is required for dataset preview")
        if jira_runtime is None:
            raise RuntimeError("runtime_common endpoints package is required for Jira dataset preview")
        host = urlparse(base_url).hostname or "jira.local"
        org_id = params.get("scope_org_id") or "jira-preview"
        scope_project = params.get("scope_project_id")
        endpoint_id = self.endpoint.table_cfg.get("endpoint_id") or self.endpoint.table_cfg.get("endpointId") or "jira-preview"
        dataset_name = dataset_id or self.endpoint.table_cfg.get("dataset") or self.endpoint.table_cfg.get("table") or "jira.issues"
        preview_limit = max(1, min(int(limit or 25), 200))
        session = jira_runtime._build_jira_session(params)  # type: ignore[attr-defined]
        try:
            rows = _collect_preview_rows(
                dataset_name,
                session,
                base_url,
                host,
                org_id,
                scope_project,
                endpoint_id,
                params,
                preview_limit,
            )
        finally:
            session.close()
        return rows

    # ------------------------------------------------------------------ helpers -------------------------------------------------
    def _resolved_parameters(self, overrides: Dict[str, Any]) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        params.update(self.endpoint.endpoint_cfg or {})
        if overrides:
            params.update(overrides)
        if jira_runtime is None:
            return params
        try:
            normalized = jira_runtime._normalize_jira_parameters(params)  # type: ignore[attr-defined]
        except Exception:
            return params
        return normalized

    def _resolve_dataset_name(self, config: Dict[str, Any]) -> str:
        candidates = [
            config.get("dataset"),
            config.get("table"),
            config.get("entity"),
            self.endpoint.table_cfg.get("table"),
        ]
        for candidate in candidates:
            if not candidate:
                continue
            normalized = str(candidate).strip().lower()
            if normalized in DATASET_DEFINITIONS:
                return normalized
            key = f"jira.{normalized}"
            if key in DATASET_DEFINITIONS:
                return key
        return "jira.issues"

    def _build_dataset_manifest(
        self,
        dataset_name: str,
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> Dict[str, Any]:
        definition = deepcopy(DATASET_DEFINITIONS.get(dataset_name) or {})
        params = self._resolved_parameters(config)
        schema_name = config.get("schema") or self.endpoint.table_cfg.get("schema") or "jira"
        manifest: Dict[str, Any] = {
            "name": definition.get("name") or dataset_name,
            "entity": definition.get("entity") or dataset_name.split(".")[-1],
            "schema": schema_name,
            "type": definition.get("type") or "semantic",
            "description": definition.get("description"),
            "properties": dict(definition.get("properties") or {}),
            "extras": dict(definition.get("extras") or {}),
        }

        fields: List[Dict[str, Any]] = []
        fields.extend(deepcopy(definition.get("static_fields") or []))
        dynamic_source = definition.get("dynamic_fields_source")
        if dynamic_source:
            fields = _merge_fields(fields, _build_dynamic_fields(dynamic_source, environment))
        manifest["fields"] = fields

        manifest["properties"].setdefault("projectKeys", params.get("project_keys", []))
        manifest["properties"].setdefault("jqlFilter", params.get("jql_filter"))
        manifest["properties"]["apiEndpoints"] = self._resolve_api_endpoints(dataset_name, definition, environment)

        value_source = definition.get("value_source")
        if value_source:
            manifest["properties"]["valueCatalog"] = _resolve_value_catalog(value_source, environment)

        manifest["extras"]["datasetId"] = dataset_name
        manifest["extras"]["apiCatalogRef"] = environment.get("api_catalog")
        manifest["extras"]["sourceEndpointId"] = self.endpoint.table_cfg.get("endpoint_id") or self.endpoint.descriptor().id
        return manifest

    def _build_datasource(self, environment: Dict[str, Any]) -> Dict[str, Any]:
        descriptor = self.endpoint.describe()
        base_url = descriptor.get("base_url") or self.endpoint.endpoint_cfg.get("base_url")
        parsed = urlparse(base_url) if base_url else None
        scope = parsed.hostname if parsed else "jira.local"
        datasource = {
            "id": f"jira::{scope}",
            "name": descriptor.get("title") or "Jira",
            "type": "jira",
            "system": base_url,
            "version": environment.get("version"),
            "properties": {
                "baseUrl": base_url,
                "domain": descriptor.get("domain"),
                "projectKeys": environment.get("project_keys") or self.endpoint.endpoint_cfg.get("project_keys") or [],
            },
            "extras": {
                "deploymentType": environment.get("deployment_type"),
                "authenticatedUser": environment.get("authenticated_user"),
            },
        }
        return datasource

    def _resolve_api_endpoints(
        self,
        dataset_name: str,
        definition: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        catalog = environment.get("api_catalog") or {}
        dataset_catalog = catalog.get("datasets", {}).get(dataset_name, [])
        if dataset_catalog:
            return dataset_catalog
        keys = definition.get("api_keys") or []
        return [_materialize_api_endpoint(key, self.endpoint.endpoint_cfg.get("base_url")) for key in keys if key in JIRA_API_LIBRARY]


# ---------------------------------------------------------------------- helper utilities ------------------------------------------


def _collect_preview_rows(
    dataset_id: str,
    session,
    base_url: str,
    host: str,
    org_id: str,
    scope_project: Optional[str],
    endpoint_id: str,
    params: Dict[str, Any],
    limit: int,
) -> List[Dict[str, Any]]:
    if jira_runtime is None:  # pragma: no cover - defensive
        return []
    normalized = _normalize_dataset_name(dataset_id)
    records: List[Dict[str, Any]] = []
    if normalized == "jira.projects":
        records, _ = _invoke_with_rate_limit_retry(
            jira_runtime._sync_jira_projects,  # type: ignore[attr-defined]
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            params,
            max_records=limit,
        )
    elif normalized == "jira.issues":
        records, _ = _invoke_with_rate_limit_retry(
            jira_runtime._sync_jira_issues,  # type: ignore[attr-defined]
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            params,
            None,
            max_records=limit,
        )
    elif normalized == "jira.users":
        records, _ = _invoke_with_rate_limit_retry(
            jira_runtime._sync_jira_users,  # type: ignore[attr-defined]
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            params,
            max_records=limit,
        )
    elif normalized == "jira.comments":
        records, _ = _invoke_with_rate_limit_retry(
            jira_runtime._sync_jira_comments,  # type: ignore[attr-defined]
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            params,
            None,
            max_records=limit,
        )
    elif normalized == "jira.worklogs":
        records, _ = _invoke_with_rate_limit_retry(
            jira_runtime._sync_jira_worklogs,  # type: ignore[attr-defined]
            session,
            base_url,
            host,
            org_id,
            scope_project,
            endpoint_id,
            params,
            None,
            max_records=limit,
        )
    elif normalized in {"jira.statuses", "jira.priorities", "jira.issue_types", "jira.api_surface"}:
        return _collect_reference_rows(normalized, session, base_url, params, limit)
    else:
        raise ValueError(f"Preview is not supported for dataset '{dataset_id}'")
    rows: List[Dict[str, Any]] = []
    for record in records[:limit]:
        payload = record.get("payload") if isinstance(record, dict) else None
        if isinstance(payload, dict):
            rows.append(payload)
        else:
            rows.append(record)
    return rows


def _split_dataset_identifier(dataset_id: str) -> tuple[str, str]:
    if not dataset_id or "." not in dataset_id:
        return (dataset_id or "dataset", dataset_id or "dataset")
    namespace, entity = dataset_id.split(".", 1)
    return namespace, entity

def _safe_fetch(session, base_url: str, path: str):
    if jira_runtime is None:
        return None
    try:
        return jira_runtime._jira_get(session, base_url, path)  # type: ignore[attr-defined]
    except Exception:
        return None


def _simplify_issue_fields(raw_fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for field in raw_fields:
        schema = field.get("schema") or {}
        simplified.append(
            {
                "id": field.get("id"),
                "key": field.get("key"),
                "name": field.get("name"),
                "type": schema.get("type") or schema.get("items"),
                "items": schema.get("items"),
                "system": schema.get("system"),
                "custom": bool(field.get("custom")),
                "operations": list(field.get("operations") or []),
                "searcherKey": schema.get("customId") or field.get("searcherKey"),
            }
        )
    return simplified


def _simplify_statuses(raw_statuses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for status in raw_statuses:
        category = status.get("statusCategory") or {}
        simplified.append(
            {
                "id": status.get("id"),
                "name": status.get("name"),
                "category": category.get("name"),
                "categoryKey": category.get("key"),
                "colorName": category.get("colorName"),
                "description": status.get("description"),
            }
        )
    return simplified


def _simplify_priorities(raw_priorities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for priority in raw_priorities:
        simplified.append(
            {
                "id": priority.get("id"),
                "name": priority.get("name"),
                "description": priority.get("description"),
                "color": priority.get("color") or priority.get("iconColor"),
            }
        )
    return simplified


def _simplify_issue_types(raw_issue_types: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for value in raw_issue_types:
        simplified.append(
            {
                "id": value.get("id"),
                "name": value.get("name"),
                "description": value.get("description"),
                "hierarchyLevel": value.get("hierarchyLevel"),
                "subtask": value.get("subtask"),
                "avatarUrl": value.get("iconUrl"),
            }
        )
    return simplified


def _build_dynamic_fields(source: str, environment: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources = (environment.get("catalog_sources") or {}).get(source, [])
    dynamic_fields: List[Dict[str, Any]] = []
    for entry in sources:
        field_name = str(entry.get("name") or entry.get("key") or "").strip()
        if not field_name:
            continue
        data_type = entry.get("type") or "STRING"
        extras = {
            "jiraFieldId": entry.get("id"),
            "jiraFieldKey": entry.get("key"),
            "operations": entry.get("operations"),
            "custom": entry.get("custom"),
        }
        comment_parts = []
        if entry.get("system"):
            comment_parts.append(f"system:{entry.get('system')}")
        if entry.get("searcherKey"):
            comment_parts.append(f"searcher:{entry.get('searcherKey')}")
        dynamic_fields.append(
            {
                "name": field_name,
                "data_type": str(data_type).upper(),
                "nullable": True,
                "comment": ", ".join(comment_parts) if comment_parts else None,
                "extras": extras,
            }
        )
    return dynamic_fields


def _merge_fields(static_fields: List[Dict[str, Any]], dynamic_fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = {str(field.get("name")).lower() for field in static_fields if field.get("name")}
    merged = list(static_fields)
    for field in dynamic_fields:
        name = str(field.get("name") or "").lower()
        if not name or name in seen:
            continue
        seen.add(name)
        merged.append(field)
    return merged


def _materialize_api_endpoint(key: str, base_url: Optional[str]) -> Dict[str, Any]:
    entry = JIRA_API_LIBRARY.get(key, {})
    path = entry.get("path")
    url = None
    if base_url and path:
        url = f"{base_url.rstrip('/')}{path}"
    return {
        "key": key,
        "method": entry.get("method"),
        "path": path,
        "description": entry.get("description"),
        "docUrl": entry.get("docs"),
        "scope": entry.get("scope"),
        "url": url,
    }


def _resolve_value_catalog(source: str, environment: Dict[str, Any]) -> List[Dict[str, Any]]:
    if source == "api_catalog":
        catalog = environment.get("api_catalog") or {}
        flattened: List[Dict[str, Any]] = []
        for dataset_values in catalog.get("datasets", {}).values():
            flattened.extend(dataset_values)
        return flattened
    catalog_sources = environment.get("catalog_sources") or {}
    values = catalog_sources.get(source)
    if isinstance(values, list):
        return values
    return []


def _build_api_catalog(params: Dict[str, Any]) -> Dict[str, Any]:
    base_url = params.get("base_url")
    datasets: Dict[str, List[Dict[str, Any]]] = {}
    for dataset_name, definition in DATASET_DEFINITIONS.items():
        keys = definition.get("api_keys") or []
        entries = [_materialize_api_endpoint(key, base_url) for key in keys if key in JIRA_API_LIBRARY]
        if entries:
            datasets[dataset_name] = entries
    return {
        "baseUrl": base_url,
        "reference": "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
        "datasets": datasets,
    }


def _collect_reference_rows(
    normalized: str,
    session,
    base_url: str,
    params: Dict[str, Any],
    limit: int,
) -> List[Dict[str, Any]]:
    if normalized == "jira.statuses":
        statuses_raw = _safe_fetch(session, base_url, "/rest/api/3/status") or []
        simplified = _simplify_statuses(statuses_raw)
        return [
            {
                "statusId": entry.get("id"),
                "name": entry.get("name"),
                "category": entry.get("category"),
                "categoryKey": entry.get("categoryKey"),
                "categoryColor": entry.get("colorName"),
                "description": entry.get("description"),
            }
            for entry in simplified[:limit]
        ]
    if normalized == "jira.priorities":
        priorities_raw = _safe_fetch(session, base_url, "/rest/api/3/priority") or []
        simplified = _simplify_priorities(priorities_raw)
        return [
            {
                "priorityId": entry.get("id"),
                "name": entry.get("name"),
                "description": entry.get("description"),
                "color": entry.get("color"),
            }
            for entry in simplified[:limit]
        ]
    if normalized == "jira.issue_types":
        issue_types_raw = _safe_fetch(session, base_url, "/rest/api/3/issuetype") or []
        simplified = _simplify_issue_types(issue_types_raw)
        return [
            {
                "typeId": entry.get("id"),
                "name": entry.get("name"),
                "description": entry.get("description"),
                "hierarchyLevel": entry.get("hierarchyLevel"),
                "subtask": entry.get("subtask"),
                "avatarUrl": entry.get("avatarUrl"),
            }
            for entry in simplified[:limit]
        ]
    if normalized == "jira.api_surface":
        catalog = _build_api_catalog(params or {})
        dataset_entries = catalog.get("datasets") or {}
        flattened: List[Dict[str, Any]] = []
        for entries in dataset_entries.values():
            flattened.extend(entries or [])
        return [
            {
                "method": entry.get("method"),
                "path": entry.get("path"),
                "scope": entry.get("scope"),
                "description": entry.get("description"),
                "docUrl": entry.get("docUrl"),
            }
            for entry in flattened[:limit]
        ]
    return []


def _invoke_with_rate_limit_retry(func, *args, **kwargs):
    attempts = 3
    delay_seconds = 2.0
    for attempt in range(attempts):
        try:
            return func(*args, **kwargs)
        except RuntimeError as error:
            message = str(error)
            if "429" not in message and "rate-limited" not in message.lower():
                raise
            if attempt == attempts - 1:
                raise
            time.sleep(delay_seconds * (attempt + 1))


__all__ = ["JiraMetadataSubsystem"]
