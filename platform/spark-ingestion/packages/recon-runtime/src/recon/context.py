from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from pyspark.sql import SparkSession

from runtime_common.common import PrintLogger
from runtime_common.endpoints.base import SourceEndpoint, SupportsQueryExecution

from metadata_sdk.types import MetadataTarget


@dataclass
class ReconContext:
    """Lightweight execution context passed to reconciliation checks."""

    spark: Optional[SparkSession]
    tool: Any
    cfg: Dict[str, Any]
    table_cfg: Dict[str, Any]
    logger: PrintLogger
    source: SourceEndpoint
    target: Optional[SupportsQueryExecution] = None
    metadata_access: Any = None
    metadata_sdk: Any = None
    metadata_gateway: Any = None
    metadata_feature_flags: Dict[str, Any] = field(default_factory=dict)

    def metadata_enabled(self, flag: str) -> bool:
        return bool(self.metadata_feature_flags.get(flag))

    def metadata_target(self) -> Optional[MetadataTarget]:
        schema = self.table_cfg.get("schema")
        table = self.table_cfg.get("table")
        if not schema or not table:
            return None
        cache_manager = getattr(self.metadata_access, "cache_manager", None)
        source_id = getattr(getattr(cache_manager, "cfg", None), "source_id", None)
        source_id = str(source_id or "reconciliation")
        return MetadataTarget(
            source_id=source_id,
            namespace=str(schema).upper(),
            entity=str(table).upper(),
        )

    def ingestion_history(self, *, limit: Optional[int] = None) -> list:
        target = self.metadata_target()
        if target is None:
            return []
        sdk = self.metadata_sdk or getattr(self.metadata_access, "sdk", None)
        if sdk:
            return list(sdk.ingestion.history(target, limit=limit))
        repository = getattr(self.metadata_access, "repository", None)
        if repository:
            return list(repository.history(target, "ingestion_volume", limit))
        return []

    def ingestion_runtime_history(self, *, limit: Optional[int] = None) -> list:
        target = self.metadata_target()
        if target is None:
            return []
        sdk = self.metadata_sdk or getattr(self.metadata_access, "sdk", None)
        if sdk:
            return list(sdk.ingestion.runtime_history(target, limit=limit))
        repository = getattr(self.metadata_access, "repository", None)
        if repository:
            return list(repository.history(target, "ingestion_runtime", limit))
        return []
