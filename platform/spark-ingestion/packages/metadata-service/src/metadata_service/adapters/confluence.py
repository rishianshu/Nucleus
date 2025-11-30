from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import requests

from metadata_service.collector import MetadataJob
from metadata_service.models import CatalogSnapshot, MetadataConfigValidationResult, MetadataPlanningResult
from metadata_service.normalizers.confluence import ConfluenceMetadataNormalizer
from metadata_service.utils import safe_upper
from runtime_core import MetadataTarget

try:  # pragma: no cover - imported dynamically when runtime packages are available
    from runtime_common.endpoints.base import MetadataSubsystem  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback when runtime packages absent
    MetadataSubsystem = object  # type: ignore[misc,assignment]

try:  # pragma: no cover - optional when running isolated tests
    from runtime_common.endpoints import confluence_http as confluence_runtime  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    confluence_runtime = None  # type: ignore

from runtime_common.endpoints.confluence_catalog import CONFLUENCE_DATASET_DEFINITIONS

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


class ConfluenceMetadataSubsystem(MetadataSubsystem):
    """Expose Confluence metadata in a catalog-friendly format."""

    DIALECT = "confluence"

    def __init__(self, endpoint: "ConfluenceEndpoint") -> None:
        self.endpoint = endpoint
        self._normalizer = ConfluenceMetadataNormalizer()

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
            raise RuntimeError("runtime_common endpoints package is required for Confluence metadata probing")
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
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> CatalogSnapshot:
        dataset_name = self._resolve_dataset_name(config)
        definition = CONFLUENCE_DATASET_DEFINITIONS.get(dataset_name)
        if not definition:
            raise ValueError(f"Unsupported Confluence dataset '{dataset_name}'")
        manifest = {
            "schema": "confluence",
            "name": definition.get("name") or dataset_name,
            "id": dataset_name,
            "entity": definition.get("entity"),
            "description": definition.get("description"),
            "fields": definition.get("static_fields") or [],
            "type": "semantic",
            "properties": {
                "domain": dataset_name,
                "api_keys": definition.get("api_keys"),
                "ingestion": definition.get("ingestion"),
            },
            "extras": {
                "datasetId": dataset_name,
            },
        }
        datasource = {
            "id": f"{self.DIALECT}:{manifest['entity']}",
            "name": "Confluence",
            "type": "confluence",
            "properties": {"baseUrl": self.endpoint.endpoint_cfg.get("base_url")},
        }
        raw = {"datasource": datasource, "dataset": manifest}
        return self._normalizer.normalize(
            raw=raw,
            environment=environment,
            config=config,
            endpoint_descriptor=self.endpoint.describe(),
        )

    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError("Confluence ingestion is not implemented in this slug.")

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        params = self._resolved_parameters(parameters)
        errors: List[str] = []
        base_url = params.get("base_url")
        if not base_url:
            errors.append("base_url is required for Confluence metadata collection.")
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
            logger.warn(event="metadata_no_confluence_datasets", endpoint=getattr(request, "endpointId", None))
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
        base_url = params.get("base_url")
        if not base_url:
            raise ValueError("Confluence base_url is required for dataset preview")
        if confluence_runtime is None:
            raise RuntimeError("runtime_common endpoints package is required for Confluence preview")
        session = confluence_runtime._build_confluence_session(params)  # type: ignore[attr-defined]
        limit = max(1, min(int(limit or 25), 200))
        dataset_key = _normalize_dataset_name(dataset_id)
        try:
            if dataset_key == "confluence.space":
                spaces = _iter_spaces(session, base_url, params, limit=limit)
                return [space for space in spaces][:limit]
            if dataset_key == "confluence.page":
                pages = _iter_pages(session, base_url, params, limit=limit)
                previews = [
                    _serialize_page_preview(confluence_runtime._render_page_preview(page))  # type: ignore[attr-defined]
                    for page in pages
                ]
                return previews[:limit]
            if dataset_key == "confluence.attachment":
                attachments = _iter_attachments(session, base_url, params, limit=limit)
                return attachments[:limit]
            raise ValueError(f"Unsupported dataset for preview: {dataset_id}")
        finally:
            session.close()

    # ------------------------------------------------------------------ helpers -------------------------------------------------
    def _resolved_parameters(self, overrides: Dict[str, Any]) -> Dict[str, Any]:
        params = dict(self.endpoint.endpoint_cfg or {})
        params.update(overrides or {})
        if confluence_runtime:
            params = confluence_runtime._normalize_confluence_parameters(params)  # type: ignore[attr-defined]
        return params

    def _resolve_dataset_name(self, cfg: Dict[str, Any]) -> str:
        dataset = (
            cfg.get("dataset")
            or cfg.get("table")
            or self.endpoint.table_cfg.get("dataset")
            or self.endpoint.table_cfg.get("table")
            or DEFAULT_CONFLUENCE_DATASET
        )
        return _normalize_dataset_name(str(dataset))


def _split_dataset_identifier(dataset_id: str) -> List[str]:
    if "." in dataset_id:
        namespace, entity = dataset_id.split(".", 1)
        return [namespace, entity]
    return [dataset_id, dataset_id]


def _normalize_dataset_name(dataset_id: Optional[str]) -> str:
    candidate = (dataset_id or "").strip()
    if not candidate:
        return DEFAULT_CONFLUENCE_DATASET
    candidate_lower = candidate.lower()
    for variant in _dataset_alias_variants(candidate_lower):
        alias = CONFLUENCE_DATASET_ALIASES.get(variant)
        if alias:
            return alias
    return candidate_lower if candidate_lower in CONFLUENCE_DATASET_DEFINITIONS else DEFAULT_CONFLUENCE_DATASET


def _dataset_alias_variants(value: str) -> List[str]:
    variants: List[str] = [value]
    if "::" in value:
        parts = [part for part in value.split("::") if part]
        if parts:
            variants.append(parts[-1])
            if len(parts) >= 2:
                namespace = parts[-2]
                slug = f"{namespace}-{parts[-1]}"
                variants.append(slug)
                variants.append(slug.replace("-", "_"))
    normalized = value.replace("::", ".")
    variants.append(normalized)
    variants.append(normalized.replace(".", "-"))
    variants.append(normalized.replace(".", "_"))
    hyphenated = value.replace("::", "-")
    variants.append(hyphenated)
    tail = value.split("::")[-1]
    variants.append(tail.replace("-", "_"))
    if "-" in tail:
        variants.append(tail.split("-", 1)[-1])
    return list(dict.fromkeys(filter(None, (variant.lower() for variant in variants))))


def _iter_spaces(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    *,
    limit: int,
) -> Iterable[Dict[str, Any]]:
    per_page = 50
    collected = 0
    start = 0
    include_archived = bool(params.get("include_archived"))
    statuses = ["current"]
    if include_archived:
        statuses.append("archived")
    space_keys = params.get("space_keys") or []
    while collected < limit:
        query: Dict[str, Any] = {
            "limit": min(per_page, limit - collected),
            "start": start,
            "type": "global",
            "status": ",".join(statuses),
            "expand": "description.plain",
        }
        if space_keys:
            query["spaceKey"] = ",".join(space_keys)
        payload = confluence_runtime._confluence_get(session, base_url, "/wiki/rest/api/space", params=query)  # type: ignore[attr-defined]
        results = payload.get("results") or []
        if not isinstance(results, list) or not results:
            break
        for entry in results:
            yield _normalize_space(entry, base_url)
            collected += 1
            if collected >= limit:
                break
        if collected >= limit:
            break
        if not payload.get("_links", {}).get("next"):
            break
        start += len(results)


def _normalize_space(entry: Dict[str, Any], base_url: str) -> Dict[str, Any]:
    key = entry.get("key") or entry.get("id")
    links = entry.get("_links") or {}
    webui = links.get("webui")
    self_link = links.get("self")
    url = urljoin(base_url, webui) if isinstance(webui, str) else self_link
    description = entry.get("description") or {}
    plain = description.get("plain") if isinstance(description, dict) else {}
    return {
        "spaceKey": key,
        "name": entry.get("name"),
        "type": entry.get("type"),
        "status": entry.get("status"),
        "url": url,
        "description": plain.get("value") if isinstance(plain, dict) else description if isinstance(description, str) else None,
    }


def _iter_pages(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    *,
    limit: int,
) -> Iterable[Dict[str, Any]]:
    per_page = 25
    collected = 0
    start = 0
    space_keys = params.get("space_keys") or []
    selected_spaces = space_keys or [space.get("spaceKey") for space in _iter_spaces(session, base_url, params, limit=5)]
    selected_spaces = [key for key in selected_spaces if key]
    for space_key in selected_spaces:
        max_pages = params.get("max_pages_per_space")
        while collected < limit:
            remaining = limit - collected
            query: Dict[str, Any] = {
                "limit": min(per_page, remaining),
                "start": start,
                "spaceKey": space_key,
                "type": "page",
                "expand": "space,version,body.storage",
            }
            payload = confluence_runtime._confluence_get(session, base_url, "/wiki/rest/api/content", params=query)  # type: ignore[attr-defined]
            results = payload.get("results") or []
            if not isinstance(results, list) or not results:
                break
            for entry in results:
                yield entry
                collected += 1
                if collected >= limit:
                    break
            if collected >= limit:
                break
            start += len(results)
            if max_pages and start >= max_pages:
                break
            if not payload.get("_links", {}).get("next"):
                break
        start = 0
        if collected >= limit:
            break


def _iter_attachments(
    session: requests.Session,
    base_url: str,
    params: Dict[str, Any],
    *,
    limit: int,
) -> List[Dict[str, Any]]:
    pages = list(_iter_pages(session, base_url, params, limit=limit))
    attachments: List[Dict[str, Any]] = []
    for page in pages:
        page_id = page.get("id")
        if not page_id:
            continue
        payload = confluence_runtime._confluence_get(  # type: ignore[attr-defined]
            session,
            base_url,
            f"/wiki/rest/api/content/{page_id}/child/attachment",
            params={"limit": min(50, limit - len(attachments)), "expand": "version"},
        )
        results = payload.get("results") or []
        for entry in results:
            attachments.append(_normalize_attachment(entry, page_id, base_url))
            if len(attachments) >= limit:
                return attachments
        if len(attachments) >= limit:
            break
    return attachments


def _normalize_attachment(entry: Dict[str, Any], page_id: Any, base_url: str) -> Dict[str, Any]:
    version = entry.get("version") or {}
    created = version.get("when") or entry.get("createdAt")
    author = version.get("by") or {}
    links = entry.get("_links") or {}
    download = links.get("download")
    download_url = urljoin(base_url, download) if isinstance(download, str) else None
    return {
        "attachmentId": entry.get("id"),
        "pageId": page_id,
        "title": entry.get("title"),
        "mediaType": entry.get("metadata", {}).get("mediaType") if isinstance(entry.get("metadata"), dict) else entry.get("mediaType"),
        "fileSize": entry.get("extensions", {}).get("fileSize") if isinstance(entry.get("extensions"), dict) else entry.get("fileSize"),
        "downloadLink": download_url,
        "createdAt": created,
        "createdBy": author.get("displayName") if isinstance(author, dict) else None,
    }


def _serialize_page_preview(preview) -> Dict[str, Any]:
    return {
        "pageId": preview.page_id,
        "title": preview.title,
        "spaceKey": preview.space_key,
        "url": preview.url,
        "excerpt": preview.excerpt,
        "updatedAt": preview.updated_at,
        "updatedBy": preview.updated_by,
    }


__all__ = ["ConfluenceMetadataSubsystem"]
