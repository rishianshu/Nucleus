from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from urllib.parse import urlparse

from metadata_service.models import CatalogSnapshot
from metadata_service.normalizers import JiraMetadataNormalizer

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


__all__ = ["JiraMetadataSubsystem"]
