"""Shared metadata record models used by ingestion, reconciliation, and collectors."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, Mapping, Optional, Protocol, Sequence, Union, runtime_checkable


@dataclass(frozen=True)
class MetadataTarget:
    source_id: str
    namespace: Optional[str] = None
    entity: Optional[str] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataContext:
    source_id: str
    job_id: Optional[str] = None
    run_id: Optional[str] = None
    namespace: Optional[str] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataRecord:
    target: MetadataTarget
    kind: str
    payload: Union[Mapping[str, Any], Any]
    produced_at: datetime
    producer_id: str
    version: Optional[str] = None
    quality: Dict[str, Any] = field(default_factory=dict)
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataQuery:
    target: Optional[MetadataTarget] = None
    kinds: Optional[Sequence[str]] = None
    include_history: bool = False
    limit: Optional[int] = None
    filters: Dict[str, Any] = field(default_factory=dict)


class MetadataEmitter(Protocol):
    def emit(self, context: MetadataContext, record: MetadataRecord) -> None:
        ...

    def emit_many(self, context: MetadataContext, records: Iterable[MetadataRecord]) -> None:
        ...


class MetadataRepository(Protocol):
    def store(self, record: MetadataRecord) -> MetadataRecord:
        ...

    def bulk_store(self, records: Iterable[MetadataRecord]) -> Sequence[MetadataRecord]:
        ...

    def latest(self, target: MetadataTarget, kind: Optional[str] = None) -> Optional[MetadataRecord]:
        ...

    def history(
        self, target: MetadataTarget, kind: Optional[str] = None, limit: Optional[int] = None
    ) -> Sequence[MetadataRecord]:
        ...

    def query(self, criteria: MetadataQuery) -> Sequence[MetadataRecord]:
        ...


@dataclass
class MetadataRequest:
    target: MetadataTarget
    artifact: Mapping[str, Any]
    context: MetadataContext
    refresh: bool = False
    config: Optional[Mapping[str, Any]] = None


@runtime_checkable
class MetadataProducer(Protocol):
    @property
    def producer_id(self) -> str:
        ...

    def capabilities(self) -> Mapping[str, Any]:
        ...

    def supports(self, request: MetadataRequest) -> bool:
        ...

    def produce(self, request: MetadataRequest) -> Iterable[MetadataRecord]:
        ...


class MetadataConsumer(Protocol):
    @property
    def consumer_id(self) -> str:
        ...

    def requirements(self) -> Mapping[str, Any]:
        ...

    def consume(
        self,
        *,
        records: Iterable[MetadataRecord],
        context: MetadataContext,
    ) -> Any:
        ...


class MetadataTransformer(Protocol):
    def applies_to(self, record: MetadataRecord) -> bool:
        ...

    def transform(self, record: MetadataRecord, context: MetadataContext) -> MetadataRecord:
        ...
