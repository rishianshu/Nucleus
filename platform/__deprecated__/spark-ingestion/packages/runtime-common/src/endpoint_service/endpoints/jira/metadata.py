from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import time
from typing import Any, Dict, Iterable, List, Optional, TYPE_CHECKING, Mapping
from urllib.parse import urlparse

from endpoint_service.endpoints.jira.normalizer import JiraMetadataNormalizer
from endpoint_service.metadata import safe_upper
from ingestion_models.metadata import (
    CatalogSnapshot,
    MetadataConfigValidationResult,
    MetadataJob,
    MetadataPlanningResult,
    MetadataProducer,
    MetadataRecord,
    MetadataRequest,
    MetadataTarget,
)

from endpoint_service.endpoints.jira.jira_catalog import JIRA_API_LIBRARY, JIRA_DATASET_DEFINITIONS
from endpoint_service.endpoints.jira import jira_http as jira_runtime
from ingestion_models.endpoints import MetadataSubsystem

if TYPE_CHECKING:  # pragma: no cover
    from endpoint_service.endpoints.jira.jira_http import JiraEndpoint

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


class JiraMetadataSubsystem(MetadataSubsystem, MetadataProducer):
    """Expose Jira metadata in a catalog-friendly format with dynamic attribute discovery."""

    def __init__(self, endpoint: "JiraEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = JiraMetadataNormalizer()
        table = endpoint.table_cfg.get("table") or "catalog"
        self._producer_id = f"jira:{table}"

    # ------------------------------------------------------------------ MetadataProducer protocol --
    @property
    def producer_id(self) -> str:
        return self._producer_id

    def supports(self, request: MetadataRequest) -> bool:
        target_ns = (request.target.namespace or "").lower()
        if target_ns and target_ns != "jira":
            return False
        artifact: Dict[str, Any] = dict(request.artifact or {})
        dataset_cfg_raw = artifact.get("dataset") if isinstance(artifact, dict) else {}
        dataset_cfg: Dict[str, Any] = dataset_cfg_raw if isinstance(dataset_cfg_raw, dict) else {}
        dataset_id = None
        if isinstance(dataset_cfg, dict):
            dataset_id = dataset_cfg.get("entity") or dataset_cfg.get("datasetId")
            raw_ingestion_cfg = dataset_cfg.get("ingestion")
            ingestion_cfg: Dict[str, Any] = raw_ingestion_cfg if isinstance(raw_ingestion_cfg, dict) else {}
            dataset_id = ingestion_cfg.get("unitId") or dataset_id
        if not dataset_id:
            dataset_id = request.target.entity
        normalized = _normalize_dataset_name(dataset_id)
        return normalized in DATASET_DEFINITIONS

    def produce(self, request: MetadataRequest) -> Iterable[MetadataRecord]:
        config = dict(request.config or {})
        artifact = dict(request.artifact or {})
        dataset_id = self._resolve_dataset_id(request=request, config=config, artifact=artifact)
        config = dict(config, dataset=dataset_id)
        probe_error: Optional[str] = None
        try:
            environment = self.probe_environment(config=config)
        except Exception as exc:
            probe_error = str(exc)
            environment = {}
        snapshot = self.collect_snapshot(request=request, environment=environment, dataset_id=dataset_id)
        produced_at = datetime.now(timezone.utc)
        extras: Dict[str, Any] = {"environment": environment, "refresh_requested": request.refresh}
        if probe_error:
            extras["environment_probe_error"] = probe_error
        record = MetadataRecord(
            target=request.target,
            kind="catalog_snapshot",
            payload=snapshot,
            produced_at=produced_at,
            producer_id=self.producer_id,
            version=None,
            quality={},
            extras=extras,
        )
        return [record]

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
            raise RuntimeError("endpoint_service endpoints package is required for Jira metadata probing")

        build_session = getattr(jira_runtime, "_build_jira_session", None)
        fetch = getattr(jira_runtime, "_jira_get", None)
        if not callable(build_session) or not callable(fetch):
            raise RuntimeError("Jira runtime helpers are unavailable")

        session = build_session(params)
        try:
            server_info = fetch(session, base_url, "/rest/api/3/serverInfo")
            user_info = fetch(session, base_url, "/rest/api/3/myself")
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
        request: MetadataRequest,
        environment: Dict[str, Any],
        dataset_id: Optional[str] = None,
    ) -> CatalogSnapshot:
        params = self._resolved_parameters(request.config or {})
        unit_id = _normalize_dataset_name(
            dataset_id
            or (request.config or {}).get("dataset")
            or (request.target.entity if request.target else None)
            or self.endpoint.table_cfg.get("table")
        )
        definition = DATASET_DEFINITIONS.get(unit_id)
        if not definition:
            raise ValueError(f"Unknown Jira dataset: {unit_id}")
        dataset_cfg = _build_dataset_config(definition, params)
        datasource_cfg = {
            "base_url": params.get("base_url"),
            "project_keys": params.get("project_keys"),
        }
        config_payload: Dict[str, Any] = dict(request.config or {})
        snapshot = self._normalizer.normalize(
            raw={"dataset": dataset_cfg, "datasource": datasource_cfg},
            environment=environment,
            config=config_payload,
            endpoint_descriptor={
                "base_url": params.get("base_url"),
                "source_id": self.endpoint.table_cfg.get("endpoint_id"),
                "title": self.endpoint.DISPLAY_NAME,
            },
        )
        return snapshot

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        normalized = self._resolved_parameters(parameters)
        errors: List[str] = []
        if not normalized.get("base_url"):
            errors.append("base_url is required")
        if not normalized.get("auth_type"):
            errors.append("auth_type is required")
        # Treat api_token as the credential for both basic and token auth flows.
        if not normalized.get("username") or not normalized.get("api_token"):
            errors.append("username/api_token required for authentication")
        return MetadataConfigValidationResult(ok=len(errors) == 0, errors=errors, normalized_parameters=normalized)

    def plan_metadata_jobs(
        self,
        *,
        parameters: Dict[str, Any],
        request: Any,
        logger,
    ) -> MetadataPlanningResult:
        params = self._resolved_parameters(parameters)
        dataset_hint = None
        if getattr(request, "datasetId", None):
            dataset_hint = request.datasetId
        elif getattr(request, "config", None):
            dataset_hint = request.config.get("dataset")
        if not dataset_hint:
            dataset_hint = params.get("dataset") or params.get("table")

        dataset_ids = (
            [_normalize_dataset_name(dataset_hint)]
            if dataset_hint
            else list(DATASET_DEFINITIONS.keys())
        )

        jobs: list[MetadataJob] = []
        source_id = getattr(request, "sourceId", None) or getattr(request, "endpointId", None) or "jira_endpoint"
        for dataset_id in dataset_ids:
            definition = DATASET_DEFINITIONS.get(dataset_id) or DATASET_DEFINITIONS.get("jira.issues")
            if not definition:
                logger.warn(event="metadata_dataset_unknown", dataset=dataset_id, endpoint=getattr(request, "endpointId", None))
                continue
            dataset_cfg = _build_dataset_config(definition, params)
            target = MetadataTarget(source_id=source_id, namespace="JIRA", entity=safe_upper(dataset_cfg.get("name") or dataset_id))
            jobs.append(MetadataJob(target=target, artifact={"dataset": dataset_cfg}, endpoint=self.endpoint))

        return MetadataPlanningResult(jobs=jobs)

    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "noop", "checkpoint": checkpoint}

    # ------------------------------------------------------------------ preview helpers --
    def preview_dataset(self, dataset_id: str, limit: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        normalized_id = _normalize_dataset_name(dataset_id)
        if "api-surface" in normalized_id or ("api" in normalized_id and "surface" in normalized_id):
            return _preview_api_surface()[:limit]
        if "statuses" in normalized_id:
            return [{"statusId": "1", "name": "To Do", "categoryColor": "blue"}][:limit]
        if normalized_id in {"jira.projects", "jira-projects"}:
            return [{"projectKey": "ENG", "name": "Engineering", "lead": "alice"}][:limit]
        # Fallback empty
        return []

    # ------------------------------------------------------------------ helpers --
    def _resolve_dataset_id(
        self, *, request: MetadataRequest, config: Dict[str, Any], artifact: Dict[str, Any]
    ) -> str:
        if isinstance(artifact.get("dataset"), dict):
            ingestion_cfg = artifact["dataset"].get("ingestion")
            if isinstance(ingestion_cfg, dict):
                unit = ingestion_cfg.get("unitId") or ingestion_cfg.get("unit_id")
                if unit:
                    return _normalize_dataset_name(unit)
            entity = artifact["dataset"].get("entity") or artifact["dataset"].get("datasetId")
            if entity:
                return _normalize_dataset_name(entity)
        if config.get("dataset"):
            return _normalize_dataset_name(config["dataset"])
        if request.target.entity:
            return _normalize_dataset_name(request.target.entity)
        return _normalize_dataset_name(self.endpoint.table_cfg.get("table"))

    def _resolved_parameters(self, config: Mapping[str, Any] | None) -> Dict[str, Any]:
        params = deepcopy(dict(config or {}))
        parameters = params.get("parameters") if isinstance(params.get("parameters"), dict) else params
        if not isinstance(parameters, dict):
            parameters = {}
        base_url = parameters.get("base_url") or self.endpoint.endpoint_cfg.get("base_url")
        if base_url and not urlparse(str(base_url)).scheme:
            base_url = f"https://{base_url}"
        resolved = dict(parameters)
        resolved["base_url"] = base_url
        resolved["project_keys"] = _split_list(parameters.get("project_keys"))
        resolved["auth_type"] = parameters.get("auth_type") or self.endpoint.endpoint_cfg.get("auth_type") or "basic"
        resolved["username"] = parameters.get("username") or self.endpoint.endpoint_cfg.get("username")
        resolved["password"] = parameters.get("password") or self.endpoint.endpoint_cfg.get("password")
        resolved["api_token"] = parameters.get("api_token") or self.endpoint.endpoint_cfg.get("api_token")
        return resolved


def _split_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _safe_fetch(session, base_url: str, path: str) -> Any:
    if jira_runtime is None:
        return None
    fetch = getattr(jira_runtime, "_jira_get", None)
    if not callable(fetch):
        return None
    try:
        return fetch(session, base_url, path)
    except Exception:
        return None


def _preview_api_surface() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for key, entry in JIRA_API_LIBRARY.items():
        rows.append(
            {
                "apiKey": key,
                "method": entry.get("method"),
                "path": entry.get("path"),
                "docUrl": entry.get("docs"),
                "scope": entry.get("scope"),
            }
        )
    return rows


def _simplify_issue_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for field in fields:
        simplified.append(
            {
                "id": field.get("id"),
                "name": field.get("name"),
                "custom": field.get("custom"),
                "schema": field.get("schema"),
            }
        )
    return simplified


def _simplify_statuses(statuses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"id": status.get("id"), "name": status.get("name"), "statusCategory": status.get("statusCategory")} for status in statuses]


def _simplify_priorities(priorities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"id": p.get("id"), "name": p.get("name"), "iconUrl": p.get("iconUrl")} for p in priorities]


def _simplify_issue_types(issue_types: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"id": t.get("id"), "name": t.get("name"), "subtask": t.get("subtask"), "description": t.get("description")} for t in issue_types]


def _build_api_catalog(params: Dict[str, Any]) -> Dict[str, Any]:
    catalog = {}
    for key, entry in JIRA_DATASET_DEFINITIONS.items():
        api_paths = entry.get("api_paths") or []
        catalog[key] = {
            "paths": api_paths,
            "project_keys": params.get("project_keys", []),
        }
    return catalog


def _build_dataset_config(definition: Dict[str, Any], params: Dict[str, Any]) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "schema": "jira",
        "entity": definition.get("datasetId"),
        "name": definition.get("name"),
        "fields": definition.get("fields"),
        "statistics": {},
        "constraints": [],
        "ingestion": {
            "unitId": definition.get("ingestion", {}).get("unit_id") if isinstance(definition.get("ingestion"), dict) else definition.get("datasetId")
        },
    }
    project_keys = params.get("project_keys")
    if project_keys:
        cfg["project_keys"] = project_keys
    return cfg


__all__ = ["JiraMetadataSubsystem"]
