from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin, urlparse

import requests

from endpoint_service.endpoints.confluence import confluence_http as confluence_runtime  # type: ignore
from endpoint_service.endpoints.confluence.confluence_catalog import CONFLUENCE_DATASET_DEFINITIONS
from endpoint_service.endpoints.confluence.normalizer import ConfluenceMetadataNormalizer
from endpoint_service.metadata import safe_upper
from ingestion_models.endpoints import MetadataSubsystem  # type: ignore
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

DEFAULT_CONFLUENCE_DATASET = "confluence.page"


def _build_dataset_aliases() -> Dict[str, str]:
    aliases: Dict[str, str] = {}
    for canonical in CONFLUENCE_DATASET_DEFINITIONS.keys():
        namespace, entity = canonical.split(".", 1)
        namespace = namespace.lower()
        entity = entity.lower()
        plural = entity if entity.endswith("s") else f"{entity}s"
        candidates = [
            canonical.lower(),
            canonical,
            f"{namespace}.{entity}",
            f"{namespace}-{entity}",
            f"{namespace}_{entity}",
            f"{namespace}{entity}",
            f"{namespace}-{plural}",
            f"{namespace}_{plural}",
            entity,
            plural,
        ]
        for candidate in candidates:
            aliases[candidate.lower()] = canonical
    return aliases


CONFLUENCE_DATASET_ALIASES = _build_dataset_aliases()


class ConfluenceMetadataSubsystem(MetadataSubsystem, MetadataProducer):
    """Expose Confluence metadata in a catalog-friendly format."""

    DIALECT = "confluence"

    def __init__(self, endpoint: "ConfluenceEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = ConfluenceMetadataNormalizer()
        table = endpoint.table_cfg.get("table") or DEFAULT_CONFLUENCE_DATASET
        self._producer_id = f"{self.DIALECT}:{table}"

    # ------------------------------------------------------------------ MetadataProducer protocol --
    @property
    def producer_id(self) -> str:
        return self._producer_id

    def supports(self, request: MetadataRequest) -> bool:
        target_ns = (request.target.namespace or "").lower()
        if target_ns and target_ns != "confluence":
            return False
        artifact = request.artifact or {}
        dataset_cfg = artifact.get("dataset") if isinstance(artifact, dict) else {}
        dataset_id = None
        if isinstance(dataset_cfg, dict):
            dataset_id = dataset_cfg.get("entity") or dataset_cfg.get("datasetId")
            ingestion_cfg = dataset_cfg.get("ingestion") if isinstance(dataset_cfg.get("ingestion"), dict) else {}
            dataset_id = ingestion_cfg.get("unitId") or dataset_id
        if not dataset_id:
            dataset_id = request.target.entity
        normalized = _normalize_dataset_id(dataset_id)
        return normalized in CONFLUENCE_DATASET_DEFINITIONS

    def produce(self, request: MetadataRequest) -> Iterable[MetadataRecord]:
        config = dict(request.config or {})
        probe_error: Optional[str] = None
        try:
            environment = self.probe_environment(config=config)
        except Exception as exc:
            probe_error = str(exc)
            environment = {}
        snapshot = self.collect_snapshot(request=request, environment=environment)
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
            "sections": ["environment", "spaces", "pages"],
            "datasets": sorted(CONFLUENCE_DATASET_DEFINITIONS.keys()),
            "supports_preview": True,
        }

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]:
        params = self._resolved_parameters(config)
        base_url = params.get("base_url")
        if not base_url:
            raise ValueError("Confluence base_url is required to probe the environment")
        if confluence_runtime is None:
            raise RuntimeError("endpoint_service endpoints package is required for Confluence metadata probing")
        session = confluence_runtime._build_confluence_session(params)  # type: ignore[attr-defined]
        try:
            site_info = confluence_runtime._confluence_get(session, base_url, "/wiki/rest/api/settings/systemInfo")  # type: ignore[attr-defined]
            user_info = confluence_runtime._confluence_get(session, base_url, "/wiki/rest/api/user/current")  # type: ignore[attr-defined]
            spaces_sample = list(
                _iter_spaces(
                    session,
                    base_url,
                    params,
                    limit=5,
                )
            )
        finally:
            session.close()
        environment = {
            "dialect": self.DIALECT,
            "base_url": base_url,
            "space_keys": params.get("space_keys", []),
            "include_archived": params.get("include_archived", False),
            "probe_time": datetime.now(timezone.utc).isoformat(),
            "site": {
                "edition": site_info.get("edition"),
                "version": site_info.get("versionNumber") or site_info.get("version"),
                "buildNumber": site_info.get("buildNumber"),
            },
            "authenticated_user": {
                "accountId": user_info.get("accountId"),
                "displayName": user_info.get("displayName") or user_info.get("username"),
                "email": user_info.get("email") or user_info.get("emailAddress"),
            },
            "spaces_preview": spaces_sample,
        }
        return environment

    def collect_snapshot(
        self,
        *,
        request: MetadataRequest,
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
        params = self._resolved_parameters(request.config or {})
        dataset_id = _normalize_dataset_id(
            (request.config or {}).get("dataset")
            or (request.target.entity if request.target else None)
            or self.endpoint.table_cfg.get("table")
        )
        definition = CONFLUENCE_DATASET_DEFINITIONS.get(dataset_id) or CONFLUENCE_DATASET_DEFINITIONS[DEFAULT_CONFLUENCE_DATASET]

        dataset_cfg = _build_dataset_config(definition, params, dataset_id=dataset_id)
        datasource_cfg = {
            "base_url": params.get("base_url"),
            "space_keys": params.get("space_keys"),
            "include_archived": params.get("include_archived", False),
        }
        return self._normalizer.normalize(
            raw={"dataset": dataset_cfg, "datasource": datasource_cfg},
            environment=environment,
            config=request.config or {},
            endpoint_descriptor={
                "base_url": params.get("base_url"),
                "source_id": self.endpoint.table_cfg.get("endpoint_id"),
                "title": self.endpoint.DISPLAY_NAME,
            },
        )

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        normalized = self._resolved_parameters(parameters)
        errors: List[str] = []
        if not normalized.get("base_url"):
            errors.append("base_url is required")
        if not normalized.get("auth_type"):
            errors.append("auth_type is required")
        if not normalized.get("username") or not (normalized.get("api_token") or normalized.get("password")):
            errors.append("username and api_token (or password) required for authentication")
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
            [_normalize_dataset_id(dataset_hint)]
            if dataset_hint
            else list(CONFLUENCE_DATASET_DEFINITIONS.keys())
        )

        jobs: list[MetadataJob] = []
        source_id = getattr(request, "sourceId", None) or getattr(request, "endpointId", None)
        for dataset_id in dataset_ids:
            definition = CONFLUENCE_DATASET_DEFINITIONS.get(dataset_id) or CONFLUENCE_DATASET_DEFINITIONS[DEFAULT_CONFLUENCE_DATASET]
            dataset_cfg = _build_dataset_config(definition, params, dataset_id=dataset_id)
            target = MetadataTarget(
                source_id=source_id,
                namespace="CONFLUENCE",
                entity=safe_upper(dataset_id.split(".")[-1]),
            )
            jobs.append(MetadataJob(target=target, artifact={"dataset": dataset_cfg}, endpoint=self.endpoint))

        return MetadataPlanningResult(jobs=jobs)

    # ------------------------------------------------------------------ helpers --
    def preview_dataset(self, dataset_id: str, limit: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        normalized = _normalize_dataset_id(dataset_id or DEFAULT_CONFLUENCE_DATASET)
        if "page" in normalized:
            return [{"pageId": "123", "title": "Welcome", "excerpt": "Sample page excerpt"}][:limit]
        if "attachment" in normalized:
            return [{"attachmentId": "att-1", "fileName": "readme.pdf"}][:limit]
        return [{"spaceKey": "ENG", "name": "Engineering"}][:limit]

    def _resolved_parameters(self, config: Dict[str, Any]) -> Dict[str, Any]:
        params = dict(config or {})
        parameters = params.get("parameters") if isinstance(params.get("parameters"), dict) else params
        if not isinstance(parameters, dict):
            parameters = {}
        base_url = parameters.get("base_url") or self.endpoint.endpoint_cfg.get("base_url")
        if base_url and not urlparse(str(base_url)).scheme:
            base_url = f"https://{base_url}"
        resolved = dict(parameters)
        resolved["base_url"] = base_url
        resolved["auth_type"] = parameters.get("auth_type") or self.endpoint.endpoint_cfg.get("auth_type") or "api_token"
        resolved["username"] = parameters.get("username") or self.endpoint.endpoint_cfg.get("username")
        resolved["password"] = parameters.get("password") or self.endpoint.endpoint_cfg.get("password")
        resolved["api_token"] = parameters.get("api_token") or self.endpoint.endpoint_cfg.get("api_token")
        resolved["space_keys"] = _split_list(parameters.get("space_keys"))
        resolved["include_archived"] = bool(parameters.get("include_archived", False))
        return resolved


def _normalize_dataset_id(dataset_id: Optional[str]) -> str:
    if not dataset_id:
        return DEFAULT_CONFLUENCE_DATASET
    lowered = dataset_id.lower()
    if lowered in CONFLUENCE_DATASET_DEFINITIONS:
        return lowered
    if lowered in CONFLUENCE_DATASET_ALIASES:
        return CONFLUENCE_DATASET_ALIASES[lowered]
    parts = lowered.split("::")
    if parts:
        candidate = parts[-1]
        return CONFLUENCE_DATASET_ALIASES.get(candidate, candidate)
    return CONFLUENCE_DATASET_ALIASES.get(lowered, lowered)


def _split_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _iter_spaces(session, base_url: str, params: Dict[str, Any], limit: int = 5) -> Iterable[Dict[str, Any]]:
    base_url = base_url.rstrip("/")
    url = urljoin(base_url, "/wiki/rest/api/space")
    next_start = 0
    fetched = 0
    while url and fetched < limit:
        resp = confluence_runtime._confluence_get(session, base_url, f"/wiki/rest/api/space?start={next_start}")  # type: ignore[attr-defined]
        values = resp.get("results") or []
        for value in values:
            yield value
            fetched += 1
            if fetched >= limit:
                break
        if fetched >= limit:
            break
        next_start = (resp.get("start") or 0) + (resp.get("limit") or 0)
        if not values or not isinstance(resp.get("_links"), dict) or "next" not in resp["_links"]:
            break


def _build_dataset_config(definition: Dict[str, Any], params: Dict[str, Any], *, dataset_id: Optional[str] = None) -> Dict[str, Any]:
    ingestion_meta = definition.get("ingestion") if isinstance(definition.get("ingestion"), dict) else {}
    resolved_id = dataset_id or definition.get("datasetId") or ingestion_meta.get("unit_id")
    cfg = {
        "schema": "confluence",
        "entity": resolved_id,
        "name": definition.get("name"),
        "fields": definition.get("fields"),
        "statistics": {},
        "constraints": [],
        "properties": {
            "space_keys": params.get("space_keys"),
            "include_archived": params.get("include_archived", False),
        },
        "ingestion": {
            "unitId": ingestion_meta.get("unit_id") or resolved_id,
        },
    }
    return cfg


__all__ = ["ConfluenceMetadataSubsystem"]
