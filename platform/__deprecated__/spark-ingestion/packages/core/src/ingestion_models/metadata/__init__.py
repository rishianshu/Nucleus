"""Shared metadata record models used by ingestion, reconciliation, and collectors."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Protocol, Sequence, Union, runtime_checkable


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
    tags: Union[Dict[str, Any], List[Any]] = field(default_factory=dict)
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
    tags: Union[Dict[str, Any], List[Any]] = field(default_factory=dict)
    properties: Dict[str, Any] = field(default_factory=dict)
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SchemaFieldStatistics:
    nulls: Optional[int] = None
    distincts: Optional[int] = None
    distinct_count: Optional[int] = None  # alias for distincts
    null_count: Optional[int] = None  # alias for nulls
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    avg_length: Optional[float] = None
    average_length: Optional[float] = None  # alias for avg_length
    max_length: Optional[int] = None
    min_length: Optional[int] = None
    histogram: Optional[Any] = None
    density: Optional[Any] = None
    last_analyzed: Optional[Any] = None
    extras: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        nulls: Optional[int] = None,
        distincts: Optional[int] = None,
        distinct_count: Optional[int] = None,
        min_value: Optional[Any] = None,
        max_value: Optional[Any] = None,
        avg_length: Optional[float] = None,
        max_length: Optional[int] = None,
        min_length: Optional[int] = None,
        histogram: Optional[Any] = None,
        extras: Optional[Dict[str, Any]] = None,
        null_count: Optional[int] = None,
        average_length: Optional[float] = None,
        density: Optional[Any] = None,
        last_analyzed: Optional[Any] = None,
        **kwargs: Any,
    ) -> None:
        # Normalize aliases and keep unknowns in extras for downstream consumers.
        self.nulls = nulls if nulls is not None else null_count
        self.null_count = null_count if null_count is not None else nulls
        self.distincts = distincts if distincts is not None else distinct_count
        self.distinct_count = distinct_count if distinct_count is not None else distincts
        self.min_value = min_value
        self.max_value = max_value
        self.avg_length = avg_length if avg_length is not None else average_length
        self.average_length = average_length if average_length is not None else avg_length
        self.max_length = max_length
        self.min_length = min_length
        self.histogram = histogram
        self.density = density
        self.last_analyzed = last_analyzed
        base_extras = extras or {}
        for key, value in kwargs.items():
            base_extras.setdefault(key, value)
        self.extras = base_extras


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
    position: Optional[int] = None
    extras: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        name: str,
        data_type: str,
        nullable: bool = True,
        precision: Optional[int] = None,
        scale: Optional[int] = None,
        length: Optional[int] = None,
        default: Optional[Any] = None,
        comment: Optional[str] = None,
        statistics: Optional[SchemaFieldStatistics] = None,
        extras: Optional[Dict[str, Any]] = None,
        position: Optional[int] = None,
        **kwargs: Any,
    ) -> None:
        # Accept legacy/extra fields like position without failing; store in extras.
        self.name = name
        self.data_type = data_type
        self.nullable = nullable
        self.precision = precision
        self.scale = scale
        self.length = length
        self.default = default
        self.comment = comment
        self.statistics = statistics
        self.position = position
        base_extras = extras or {}
        # Fold any unknown kwargs into extras for downstream consumers.
        for key, value in kwargs.items():
            if key == "position":
                if self.position is None:
                    self.position = value
                base_extras.setdefault("position", value)
            else:
                base_extras.setdefault(key, value)
        self.extras = base_extras


@dataclass
class DatasetStatistics:
    row_count: Optional[int] = None
    record_count: Optional[int] = None  # alias for row_count
    size_bytes: Optional[int] = None
    last_analyzed_at: Optional[str] = None
    stale: Optional[bool] = None
    blocks: Optional[int] = None
    partitions: Optional[int] = None
    storage_blocks: Optional[int] = None
    average_record_size: Optional[int] = None
    sample_size: Optional[int] = None
    last_profiled_at: Optional[str] = None
    extras: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        row_count: Optional[int] = None,
        size_bytes: Optional[int] = None,
        last_analyzed_at: Optional[str] = None,
        stale: Optional[bool] = None,
        blocks: Optional[int] = None,
        partitions: Optional[int] = None,
        extras: Optional[Dict[str, Any]] = None,
        record_count: Optional[int] = None,
        storage_blocks: Optional[int] = None,
        average_record_size: Optional[int] = None,
        sample_size: Optional[int] = None,
        last_profiled_at: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        # Accept record_count alias and fold unknowns into extras.
        self.row_count = row_count if row_count is not None else record_count
        self.record_count = record_count if record_count is not None else row_count
        self.size_bytes = size_bytes
        self.last_analyzed_at = last_analyzed_at
        self.stale = stale
        self.blocks = blocks
        self.partitions = partitions
        self.storage_blocks = storage_blocks
        self.average_record_size = average_record_size
        self.sample_size = sample_size
        self.last_profiled_at = last_profiled_at
        base_extras = extras or {}
        for key, value in kwargs.items():
            base_extras.setdefault(key, value)
        self.extras = base_extras


@dataclass
class DatasetConstraintField:
    name: str
    position: Optional[int] = None

    def __init__(self, name: Optional[str] = None, position: Optional[int] = None, field: Optional[str] = None) -> None:
        self.name = name or field or ""
        self.position = position


@dataclass
class DatasetConstraint:
    """Represents primary/foreign key or unique constraints."""

    name: Optional[str] = None
    type: str = "primary_key"  # primary_key | foreign_key | unique | check
    constraint_type: Optional[str] = None
    fields: List[DatasetConstraintField] = field(default_factory=list)
    referenced_table: Optional[str] = None
    referenced_fields: List[str] = field(default_factory=list)
    definition: Optional[str] = None
    status: Optional[str] = None
    deferrable: Optional[bool] = None
    deferred: Optional[bool] = None
    validated: Optional[bool] = None
    generated: Optional[str] = None
    delete_rule: Optional[str] = None
    referenced_constraint: Optional[str] = None
    extras: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        name: Optional[str] = None,
        type: str = "primary_key",
        fields: Optional[List[DatasetConstraintField]] = None,
        referenced_table: Optional[str] = None,
        referenced_fields: Optional[List[str]] = None,
        definition: Optional[str] = None,
        extras: Optional[Dict[str, Any]] = None,
        constraint_type: Optional[str] = None,
        status: Optional[str] = None,
        deferrable: Optional[bool] = None,
        deferred: Optional[bool] = None,
        validated: Optional[bool] = None,
        generated: Optional[str] = None,
        delete_rule: Optional[str] = None,
        referenced_constraint: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        self.name = name
        self.type = type or constraint_type or "primary_key"
        self.constraint_type = constraint_type or type
        self.fields = fields or []
        self.referenced_table = referenced_table
        self.referenced_fields = referenced_fields or []
        self.definition = definition
        self.status = status
        self.deferrable = deferrable
        self.deferred = deferred
        self.validated = validated
        self.generated = generated
        self.delete_rule = delete_rule
        self.referenced_constraint = referenced_constraint
        base_extras = extras or {}
        for key, value in kwargs.items():
            base_extras.setdefault(key, value)
        self.extras = base_extras


@dataclass
class CatalogSnapshot:
    source: str
    schema: Optional[str] = None
    table: Optional[str] = None
    collected_at: Optional[str] = None
    name: Optional[str] = None
    version: Optional[str] = None
    fields: List[SchemaField] = field(default_factory=list)
    schema_fields: List[SchemaField] = field(default_factory=list)
    statistics: Optional[DatasetStatistics] = None
    constraints: List[DatasetConstraint] = field(default_factory=list)
    data_source: Optional[DataSourceMetadata] = None
    dataset: Optional[DatasetMetadata] = None
    raw_vendor: Optional[Dict[str, Any]] = None
    extras: Dict[str, Any] = field(default_factory=dict)

    def __init__(
        self,
        source: str,
        schema: Optional[str] = None,
        table: Optional[str] = None,
        collected_at: Optional[str] = None,
        name: Optional[str] = None,
        version: Optional[str] = None,
        fields: Optional[List[SchemaField]] = None,
        schema_fields: Optional[List[SchemaField]] = None,
        statistics: Optional[DatasetStatistics] = None,
        constraints: Optional[List[DatasetConstraint]] = None,
        data_source: Optional[DataSourceMetadata] = None,
        dataset: Optional[DatasetMetadata] = None,
        raw_vendor: Optional[Dict[str, Any]] = None,
        extras: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        self.source = source
        self.schema = schema
        self.table = table or name
        self.name = name or table
        self.collected_at = collected_at
        self.version = version
        resolved_fields = schema_fields or fields or []
        self.fields = resolved_fields
        self.schema_fields = resolved_fields
        self.statistics = statistics
        self.constraints = constraints or []
        self.data_source = data_source
        self.dataset = dataset
        self.raw_vendor = raw_vendor
        base_extras = extras or {}
        for key, value in kwargs.items():
            base_extras.setdefault(key, value)
        self.extras = base_extras


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
    cleanup_callbacks: List[Callable[[], None]] = field(default_factory=list)


@dataclass
class MetadataJob:
    endpoint: Any
    target: MetadataTarget
    artifact: Dict[str, Any]
