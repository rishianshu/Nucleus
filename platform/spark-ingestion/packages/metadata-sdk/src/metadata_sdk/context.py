from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .types import MetadataContext, MetadataTarget


@dataclass
class ContextOptions:
    source_id: str
    namespace: Optional[str] = None
    run_id: Optional[str] = None


class ContextBuilder:
    """Utility to construct MetadataContext with sensible defaults."""

    def __init__(self, options: ContextOptions) -> None:
        self.options = options

    def for_target(self, target: MetadataTarget) -> MetadataContext:
        return MetadataContext(
            source_id=self.options.source_id,
            namespace=target.namespace or self.options.namespace,
            run_id=self.options.run_id,
        )

    def default(self) -> MetadataContext:
        return MetadataContext(
            source_id=self.options.source_id,
            namespace=self.options.namespace,
            run_id=self.options.run_id,
        )
