from __future__ import annotations

from typing import Iterable, Optional, Protocol, Sequence

try:
    from metadata_gateway import MetadataGateway
    from runtime_core import MetadataContext, MetadataQuery, MetadataRecord, MetadataRepository, MetadataTarget
except ModuleNotFoundError:  # pragma: no cover - fallback when packages not installed
    import sys
    from pathlib import Path

    _root = next((p for p in Path(__file__).resolve().parents if (p / "packages").exists()), None)
    if _root is not None:
        gateway_src = _root / "packages" / "metadata-gateway" / "src"
        core_src = _root / "packages" / "core" / "src"
        if gateway_src.exists():
            sys.path.append(str(gateway_src))
        if core_src.exists():
            sys.path.append(str(core_src))
        from metadata_gateway import MetadataGateway  # type: ignore  # noqa: E402
        from runtime_core import (  # type: ignore  # noqa: E402
            MetadataContext,
            MetadataQuery,
            MetadataRecord,
            MetadataRepository,
            MetadataTarget,
        )
    else:  # pragma: no cover - defensive
        raise


class Transport(Protocol):
    """Minimal transport API consumed by SDK services."""

    def emit(self, context: MetadataContext, record: MetadataRecord) -> None:
        ...

    def emit_many(self, context: MetadataContext, records: Iterable[MetadataRecord]) -> None:
        ...

    def latest(self, target: MetadataTarget, kind: Optional[str] = None) -> Optional[MetadataRecord]:
        ...

    def history(
        self,
        target: MetadataTarget,
        kind: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Sequence[MetadataRecord]:
        ...

    def query(self, criteria: MetadataQuery) -> Sequence[MetadataRecord]:
        ...


class EmbeddedTransport(Transport):
    """Transport backed by an in-process repository/gateway."""

    def __init__(
        self,
        repository: MetadataRepository,
        *,
        gateway: Optional[MetadataGateway] = None,
    ) -> None:
        self._repository = repository
        self._gateway = gateway or MetadataGateway(repository)

    def emit(self, context: MetadataContext, record: MetadataRecord) -> None:
        self._gateway.emit(context, record)

    def emit_many(self, context: MetadataContext, records: Iterable[MetadataRecord]) -> None:
        self._gateway.emit_many(context, records)

    def latest(self, target: MetadataTarget, kind: Optional[str] = None) -> Optional[MetadataRecord]:
        return self._repository.latest(target, kind)

    def history(
        self,
        target: MetadataTarget,
        kind: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Sequence[MetadataRecord]:
        return self._repository.history(target, kind, limit)

    def query(self, criteria: MetadataQuery) -> Sequence[MetadataRecord]:
        return self._repository.query(criteria)
