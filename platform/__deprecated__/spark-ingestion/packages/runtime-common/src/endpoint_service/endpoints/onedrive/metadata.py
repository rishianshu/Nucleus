from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, TYPE_CHECKING

from endpoint_service.endpoints.onedrive import onedrive_http as onedrive_runtime
from endpoint_service.endpoints.onedrive.onedrive_catalog import DEFAULT_ONEDRIVE_DATASET, ONEDRIVE_DATASET_DEFINITIONS
from endpoint_service.endpoints.onedrive.normalizer import OneDriveMetadataNormalizer
from ingestion_models.endpoints import MetadataSubsystem
from ingestion_models.metadata import (
    MetadataConfigValidationResult,
    MetadataJob,
    MetadataPlanningResult,
    MetadataProducer,
    MetadataRecord,
    MetadataRequest,
    MetadataTarget,
)

if TYPE_CHECKING:  # pragma: no cover
    from endpoint_service.endpoints.onedrive.onedrive_http import OneDriveEndpoint


class OneDriveMetadataSubsystem(MetadataSubsystem, MetadataProducer):
    """Expose OneDrive metadata as catalog datasets."""

    DIALECT = "onedrive"

    def __init__(self, endpoint: "OneDriveEndpoint") -> None:
        self.endpoint = endpoint
        table = endpoint.table_cfg.get("table") or DEFAULT_ONEDRIVE_DATASET
        self._producer_id = f"{self.DIALECT}:{table}"
        self._normalizer = OneDriveMetadataNormalizer()

    # ------------------------------------------------------------------ MetadataProducer protocol --
    @property
    def producer_id(self) -> str:
        return self._producer_id

    def supports(self, request: MetadataRequest) -> bool:
        target_ns = (request.target.namespace or "").lower()
        if target_ns and target_ns not in ("onedrive", "docs", "catalog.dataset"):
            return False
        dataset_id = (request.target.entity or DEFAULT_ONEDRIVE_DATASET) if request.target else DEFAULT_ONEDRIVE_DATASET
        return str(dataset_id).lower() in (DEFAULT_ONEDRIVE_DATASET, DEFAULT_ONEDRIVE_DATASET.lower())

    def produce(self, request: MetadataRequest) -> Iterable[MetadataRecord]:
        config = dict(request.config or {})
        probe_error: Optional[str] = None
        try:
            environment = self.probe_environment(config=config)
        except Exception as exc:  # pragma: no cover - defensive
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
            "sections": ["environment", "files"],
            "datasets": [DEFAULT_ONEDRIVE_DATASET],
            "supports_preview": True,
        }

    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "noop", "checkpoint": checkpoint}

    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> MetadataConfigValidationResult:
        drive_id = parameters.get("drive_id") or self.endpoint.endpoint_cfg.get("drive_id")
        if not drive_id:
            return MetadataConfigValidationResult(ok=False, success=False, message="drive_id is required")
        return MetadataConfigValidationResult(ok=True, success=True)

    def plan_metadata_jobs(self, *, parameters: Dict[str, Any], request: Dict[str, Any], logger) -> MetadataPlanningResult:
        source_id = self.endpoint.table_cfg.get("endpoint_id") or self.endpoint.endpoint_cfg.get("endpoint_id") or self.DIALECT
        target = MetadataTarget(source_id=source_id, namespace=self.DIALECT, entity=DEFAULT_ONEDRIVE_DATASET)
        job = MetadataJob(target=target, artifact={"dataset": {"id": DEFAULT_ONEDRIVE_DATASET, "config": parameters}}, endpoint=self.endpoint)
        return MetadataPlanningResult(jobs=[job])

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]:
        params = self._resolved_parameters(config)
        base_url = params["base_url"]
        drive_id = params["drive_id"]
        session = onedrive_runtime._build_onedrive_session(params)
        try:
            drive_payload = onedrive_runtime._onedrive_get(session, base_url, f"drives/{drive_id}") or {}
        finally:
            session.close()
        return {
            "dialect": self.DIALECT,
            "base_url": base_url,
            "drive_id": drive_id,
            "probe_time": datetime.now(timezone.utc).isoformat(),
            "drive": drive_payload,
        }

    def collect_snapshot(self, *, request: MetadataRequest, environment: Dict[str, Any]):
        params = self._resolved_parameters(dict(request.config or {}))
        base_url = params["base_url"]
        drive_id = params["drive_id"]
        session = onedrive_runtime._build_onedrive_session(params)
        try:
            files = list(
                onedrive_runtime._iter_drive_items(
                    session,
                    base_url,
                    drive_id,
                    root_path=params.get("root_path") or "/",
                    max_items=50,
                )
            )
        finally:
            session.close()

        endpoint_id = self.endpoint.table_cfg.get("endpoint_id")
        dataset_cfg = {
            "id": DEFAULT_ONEDRIVE_DATASET,
            "name": f"OneDrive Docs ({drive_id})",
            "schema": "onedrive",
            "table": DEFAULT_ONEDRIVE_DATASET,
            "type": "semantic",
            "description": "Documents discovered under the configured drive/root path.",
            "fields": ONEDRIVE_DATASET_DEFINITIONS[DEFAULT_ONEDRIVE_DATASET].get("fields"),
            "extras": {
                "datasetId": DEFAULT_ONEDRIVE_DATASET,
                "driveId": drive_id,
                "root_path": params.get("root_path"),
                "source_system": "onedrive",
                "ingestion": {
                    "unitId": DEFAULT_ONEDRIVE_DATASET,
                    "mode": "cdm",
                    "cursor": "lastModifiedDateTime",
                },
                "metadata_endpoint_id": endpoint_id,
                "_metadata": {"source_endpoint_id": endpoint_id} if endpoint_id else {},
            },
        }
        datasource_cfg = {
            "id": drive_id,
            "name": f"OneDrive ({drive_id})",
            "type": "onedrive",
            "system": base_url,
            "description": "OneDrive drive",
            "properties": {"root_path": params.get("root_path")},
            "extras": {"drive": environment.get("drive")},
            "drive_id": drive_id,
        }
        return self._normalizer.normalize(
            raw={"dataset": dataset_cfg, "datasource": datasource_cfg, "files": files},
            environment=environment,
            config=params,
            endpoint_descriptor={
                "base_url": base_url,
                "source_id": endpoint_id,
                "title": self.endpoint.DISPLAY_NAME,
            },
        )

    def preview_dataset(self, dataset_id: str, *, limit: int, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        params = self._resolved_parameters(dict(config or {}))
        base_url = params["base_url"]
        drive_id = params["drive_id"]
        session = onedrive_runtime._build_onedrive_session(params)
        try:
            return list(
                onedrive_runtime._iter_drive_items(
                    session,
                    base_url,
                    drive_id,
                    root_path=params.get("root_path") or "/",
                    max_items=max(1, min(limit, 20)),
                )
            )
        finally:
            session.close()

    # ------------------------------------------------------------------ helpers --
    def _resolved_parameters(self, config: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(self.endpoint.endpoint_cfg)
        merged.update(config or {})
        normalized = onedrive_runtime._normalize_onedrive_parameters(merged)
        base_url = normalized.get("base_url") or self.endpoint.GRAPH_BASE_URL
        drive_id = normalized.get("drive_id") or self.endpoint.endpoint_cfg.get("drive_id")
        if not drive_id:
            raise ValueError("drive_id is required for OneDrive metadata collection")
        normalized["base_url"] = str(base_url).rstrip("/") + "/"
        normalized["drive_id"] = drive_id
        return normalized


__all__ = ["OneDriveMetadataSubsystem"]
