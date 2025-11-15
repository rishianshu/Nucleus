from __future__ import annotations

from typing import Iterable, Optional, Sequence

from runtime_core import (
    MetadataContext,
    MetadataEmitter,
    MetadataQuery,
    MetadataRecord,
    MetadataRepository,
    MetadataTarget,
)


class MetadataGateway:
    """Coordinates metadata emission and lookup through a repository or emitter."""

    def __init__(
        self,
        repository: MetadataRepository,
        *,
        emitter: Optional[MetadataEmitter] = None,
    ) -> None:
        self._repository = repository
        self._emitter = emitter

    def emit(self, context: MetadataContext, record: MetadataRecord) -> None:
        """Emit a single record, defaulting to repository storage when no emitter is configured."""
        if self._emitter is not None:
            self._emitter.emit(context, record)
        else:
            self._repository.store(record)

    def emit_many(self, context: MetadataContext, records: Iterable[MetadataRecord]) -> None:
        """Emit a collection of records."""
        if self._emitter is not None:
            self._emitter.emit_many(context, records)
        else:
            self._repository.bulk_store(records)

    def latest(self, target: MetadataTarget, kind: Optional[str] = None) -> Optional[MetadataRecord]:
        """Return the latest record for the given target/kind."""
        return self._repository.latest(target, kind)

    def history(
        self,
        target: MetadataTarget,
        kind: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Sequence[MetadataRecord]:
        """Return historical records ordered by recency."""
        return self._repository.history(target, kind, limit)

    def query(self, criteria: MetadataQuery) -> Sequence[MetadataRecord]:
        """Run an arbitrary repository query."""
        return self._repository.query(criteria)
