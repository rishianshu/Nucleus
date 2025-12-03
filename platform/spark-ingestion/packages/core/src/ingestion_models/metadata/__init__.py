"""Shared metadata record models used by ingestion, reconciliation, and collectors."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, List, Mapping, Optional, Protocol, Sequence, Union, runtime_checkable


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


# Catalog/dataset metadata models
@dataclass
class DataSourceMetadata:
    """Describes a physical or logical data source/system."""

    id: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None  # e.g., oracle, snowflake, s3
    system: Optional[str] = None  # hostname, account, cluster
    environment: Optional[str] = None  # prod, staging, region
    version: Optional[str] = None
    description: Optional[str] = None
    tags: Dict[str, Any] = field(default_factory=dict)
    properties: Dict[str, Any] = field(default_factory=dict)
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DatasetMetadata:
    """Represents a dataset/table/view exposed to consumers."""

    id: Optional[str] = None
    name: str = ""
    physical_name: Optional[str] = None
    type: str = "table"  # table, view, stream, file, topic
    source_id: Optional[str] = None
    location: Optional[str] = None  # path, database.schema, bucket/key
    description: Optional[str] = None
    tags: Dict[str, Any] = field(default_factory=dict)
    properties: Dict[str, Any] = field(default_factory=dict)
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SchemaFieldStatistics:
    nulls: Optional[int] = None
    distincts: Optional[int] = None
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    avg_length: Optional[float] = None
    max_length: Optional[int] = None
    min_length: Optional[int] = None
    histogram: Optional[Any] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SchemaField:
    name: str
    data_type: str
    nullable: bool = True
    precision: Optional[int] = None
    scale: Optional[int] = None
    length: Optional[int] = None
    default: Optional[Any] = None
    comment: Optional[str] = None
    statistics: Optional[SchemaFieldStatistics] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DatasetStatistics:
    row_count: Optional[int] = None
    size_bytes: Optional[int] = None
    last_analyzed_at: Optional[str] = None
    stale: Optional[bool] = None
    blocks: Optional[int] = None
    partitions: Optional[int] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DatasetConstraintField:
    name: str
    position: int


@dataclass
class DatasetConstraint:
    """Represents primary/foreign key or unique constraints."""

    name: Optional[str] = None
    type: str = "primary_key"  # primary_key | foreign_key | unique | check
    fields: List[DatasetConstraintField] = field(default_factory=list)
    referenced_table: Optional[str] = None
    referenced_fields: List[str] = field(default_factory=list)
    definition: Optional[str] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CatalogSnapshot:
    source: str
    schema: str
    table: str
    collected_at: str
    version: Optional[str] = None
    fields: List[SchemaField] = field(default_factory=list)
    statistics: Optional[DatasetStatistics] = None
    constraints: List[DatasetConstraint] = field(default_factory=list)
    data_source: Optional[DataSourceMetadata] = None
    dataset: Optional[DatasetMetadata] = None
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataConfigValidationResult:
    """
    Validation outcome for endpoint metadata configuration.

    `ok`/`errors`/`warnings` align with legacy callers, while `success`/`message`/`details`
    provide a more general shape for newer consumers.
    """

    ok: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    normalized_parameters: Dict[str, Any] = field(default_factory=dict)
    success: bool = True
    message: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataPlanningResult:
    jobs: List["MetadataJob"] = field(default_factory=list)
    success: bool = True
    message: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetadataJob:
    endpoint: Any
    target: MetadataTarget
    artifact: Dict[str, Any]
