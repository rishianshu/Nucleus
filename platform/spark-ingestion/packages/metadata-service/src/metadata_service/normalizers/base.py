from __future__ import annotations

from typing import Dict, Protocol

from metadata_service.models import CatalogSnapshot


class MetadataNormalizer(Protocol):
    """Protocol for transforming raw catalog payloads into neutral snapshots."""

    def normalize(
        self,
        *,
        raw: Dict[str, object],
        environment: Dict[str, object],
        config: Dict[str, object],
        endpoint_descriptor: Dict[str, object],
    ) -> CatalogSnapshot:
        ...


__all__ = ["MetadataNormalizer"]
