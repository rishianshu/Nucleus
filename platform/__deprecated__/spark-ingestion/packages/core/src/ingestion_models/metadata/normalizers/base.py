from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict

from ingestion_models.metadata import CatalogSnapshot


class MetadataNormalizer(ABC):
    @abstractmethod
    def normalize(
        self,
        *,
        raw: Dict[str, Any],
        environment: Dict[str, Any],
        config: Dict[str, Any],
        endpoint_descriptor: Dict[str, Any],
    ) -> CatalogSnapshot:
        ...
