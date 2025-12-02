from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Dict, Iterable, List, Optional, Protocol, Tuple, TYPE_CHECKING, runtime_checkable

if TYPE_CHECKING:
    from pyspark.sql import DataFrame
    from metadata_service.models import CatalogSnapshot, MetadataConfigValidationResult, MetadataPlanningResult
    from runtime_common.tools.base import ExecutionTool
    from runtime_common.query.plan import QueryPlan, QueryResult


class EndpointRole(Enum):
    SOURCE = auto()
    SINK = auto()
    BIDIRECTIONAL = auto()


class EndpointType(Enum):
    JDBC = auto()
    HDFS = auto()
    ICEBERG = auto()
    UNKNOWN = auto()


@dataclass(frozen=True)
class EndpointFieldOption:
    label: str
    value: str
    description: Optional[str] = None


@dataclass(frozen=True)
class EndpointFieldDescriptor:
    key: str
    label: str
    value_type: str
    required: bool = True
    semantic: str = "GENERIC"
    description: Optional[str] = None
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    options: Tuple[EndpointFieldOption, ...] = ()
    regex: Optional[str] = None
    min_value: Optional[int] = None
    max_value: Optional[int] = None
    default_value: Optional[str] = None
    advanced: bool = False
    sensitive: bool = False
    depends_on: Optional[str] = None
    depends_value: Optional[str] = None
    visible_when: Optional[Dict[str, Tuple[str, ...]]] = None


@dataclass(frozen=True)
class EndpointCapabilityDescriptor:
    key: str
    label: str
    description: Optional[str] = None


@dataclass(frozen=True)
class EndpointConnectionTemplate:
    url_template: str
    default_verb: str = "POST"


@dataclass(frozen=True)
class EndpointProbingMethod:
    key: str
    label: str
    strategy: str  # e.g., SQL, JDBC, HTTP
    statement: Optional[str] = None
    description: Optional[str] = None
    requires: Tuple[str, ...] = ()
    returns_version: bool = True
    returns_capabilities: Tuple[str, ...] = ()


@dataclass(frozen=True)
class EndpointProbingPlan:
    methods: Tuple[EndpointProbingMethod, ...] = ()
    fallback_message: Optional[str] = None


@dataclass(frozen=True)
class EndpointDescriptor:
    """Static description consumed by the console + registry for configuration."""

    id: str
    family: str
    title: str
    vendor: str
    description: Optional[str] = None
    domain: Optional[str] = None
    categories: Tuple[str, ...] = ()
    protocols: Tuple[str, ...] = ()
    versions: Tuple[str, ...] = ()
    default_port: Optional[int] = None
    driver: Optional[str] = None
    docs_url: Optional[str] = None
    agent_prompt: Optional[str] = None
    default_labels: Tuple[str, ...] = ()
    fields: Tuple[EndpointFieldDescriptor, ...] = ()
    capabilities: Tuple[EndpointCapabilityDescriptor, ...] = ()
    sample_config: Optional[Dict[str, Any]] = None
    connection: Optional[EndpointConnectionTemplate] = None
    descriptor_version: str = "1.0"
    min_version: Optional[str] = None
    max_version: Optional[str] = None
    probing: Optional[EndpointProbingPlan] = None
    extras: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class EndpointConnectionResult:
    url: str
    config: Dict[str, Any]
    labels: Tuple[str, ...] = ()
    domain: Optional[str] = None
    verb: Optional[str] = None


@dataclass(frozen=True)
class EndpointTestResult:
    success: bool
    message: Optional[str] = None
    detected_version: Optional[str] = None
    capabilities: Tuple[str, ...] = ()
    details: Optional[Dict[str, Any]] = None


@dataclass
class EndpointCapabilities:
    supports_full: bool = True
    supports_incremental: bool = False
    supports_count_probe: bool = False
    supports_preview: bool = False
    supports_write: bool = False
    supports_finalize: bool = False
    supports_publish: bool = False
    supports_watermark: bool = False
    supports_staging: bool = False
    supports_merge: bool = False
    supports_metadata: bool = False
    incremental_literal: str = "timestamp"  # timestamp | epoch
    default_fetchsize: int = 10000
    event_metadata_keys: Tuple[str, ...] = ()


@runtime_checkable
class BaseEndpoint(Protocol):
    """Common methods for both source and sink endpoints."""

    tool: Any

    def configure(self, table_cfg: Dict[str, Any]) -> None: ...

    def capabilities(self) -> EndpointCapabilities: ...

    def describe(self) -> Dict[str, Any]: ...


@runtime_checkable
class DescribedEndpoint(Protocol):
    """Endpoints that can describe themselves for registration/UIs."""

    @classmethod
    def descriptor(cls) -> EndpointDescriptor: ...

    @classmethod
    def descriptor_fields(cls) -> Tuple[EndpointFieldDescriptor, ...]: ...

    @classmethod
    def descriptor_capabilities(cls) -> Tuple[EndpointCapabilityDescriptor, ...]: ...

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult: ...

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult: ...


@runtime_checkable
class ConfigurableEndpoint(BaseEndpoint, DescribedEndpoint, Protocol):
    """Endpoints that expose both runtime operations and descriptors for configuration."""
    ...


@runtime_checkable
class SupportsQueryExecution(Protocol):
    """Endpoints capable of executing logical query plans."""

    def execute_query_plan(self, plan: "QueryPlan") -> "QueryResult": ...


@runtime_checkable
class SupportsStreamingQuery(Protocol):
    def stream_query_plan(self, plan: "QueryPlan") -> Iterable[Dict[str, Any]]: ...


@runtime_checkable
class SupportsDataFrameQuery(Protocol):
    def dataframe_query_plan(self, plan: "QueryPlan"):
        ...


@runtime_checkable
class SupportsPreview(Protocol):
    """Endpoints that can return a small preview of data/records."""

    def preview(
        self,
        *,
        unit_id: Optional[str] = None,
        limit: int = 50,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        ...


@runtime_checkable
class SourceEndpoint(ConfigurableEndpoint, Protocol):
    """Contract for any endpoint that can provide data."""

    def read_full(self) -> Any: ...

    def read_slice(self, *, lower: str, upper: Optional[str]) -> Any: ...

    def count_between(self, *, lower: str, upper: Optional[str]) -> int: ...


@dataclass
class SinkWriteResult:
    rows: int
    path: str
    event_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SinkFinalizeResult:
    final_path: str
    event_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestionSlice:
    lower: str
    upper: Optional[str] = None


@dataclass(frozen=True)
class EndpointUnitDescriptor:
    """Describes a logical ingestion unit (usually a dataset) exposed by a source endpoint."""

    unit_id: str
    kind: str = "dataset"
    display_name: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[Dict[str, Any]] = None
    supports_incremental: bool = False
    default_policy: Optional[Dict[str, Any]] = None
    cdm_model_id: Optional[str] = None


@dataclass
class SliceStageResult:
    slice: IngestionSlice
    path: str
    rows: int
    skipped: bool = False
    event_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IncrementalContext:
    schema: str
    table: str
    load_date: str
    incremental_column: str
    incremental_type: str
    primary_keys: List[str]
    effective_watermark: str
    last_watermark: str
    last_loaded_date: str
    planner_metadata: Dict[str, Any] = field(default_factory=dict)
    is_epoch: bool = False


@dataclass
class IncrementalCommitResult:
    rows: int
    raw_path: str
    new_watermark: str
    new_loaded_date: str
    raw_event_payload: Dict[str, Any] = field(default_factory=dict)
    intermediate_event_payload: Dict[str, Any] = field(default_factory=dict)
    additional_metadata: Dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class SinkEndpoint(ConfigurableEndpoint, Protocol):
    """Contract for landing data and finalising outputs."""

    def write_raw(
        self,
        df: DataFrame,
        *,
        mode: str,
        load_date: str,
        schema: str,
        table: str,
    ) -> SinkWriteResult: ...

    def finalize_full(
        self,
        *,
        load_date: str,
        schema: str,
        table: str,
    ) -> SinkFinalizeResult: ...

    def stage_incremental_slice(
        self,
        df: DataFrame,
        *,
        context: IncrementalContext,
        slice_info: IngestionSlice,
    ) -> SliceStageResult: ...

    def commit_incremental(
        self,
        *,
        load_date: str,
        schema: str,
        table: str,
        context: IncrementalContext,
        staged_slices: List[SliceStageResult],
    ) -> IncrementalCommitResult: ...

    def publish_dataset(
        self,
        *,
        load_date: str,
        schema: str,
        table: str,
    ) -> Dict[str, Any]: ...

    def latest_watermark(
        self,
        *,
        schema: str,
        table: str,
    ) -> Optional[str]: ...


@runtime_checkable
class DataEndpoint(SourceEndpoint, SinkEndpoint, Protocol):
    """Endpoints that support both source and sink operations."""
    ...


@runtime_checkable
class MetadataSubsystem(Protocol):
    """Metadata subsystem implemented by capable source endpoints."""

    def probe_environment(self, *, config: Dict[str, Any]) -> Dict[str, Any]: ...

    def collect_snapshot(
        self,
        *,
        config: Dict[str, Any],
        environment: Dict[str, Any],
    ) -> "CatalogSnapshot": ...

    def capabilities(self) -> Dict[str, Any]: ...
    def ingest(self, *, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> Dict[str, Any]: ...
    def validate_metadata_config(self, *, parameters: Dict[str, Any]) -> "MetadataConfigValidationResult": ...
    def plan_metadata_jobs(self, *, parameters: Dict[str, Any], request: Dict[str, Any], logger) -> "MetadataPlanningResult": ...


@runtime_checkable
class MetadataCapableEndpoint(SourceEndpoint, Protocol):
    """Source endpoints that expose a metadata subsystem."""

    def metadata_subsystem(self) -> MetadataSubsystem: ...


def load_metadata_adapter(endpoint_name: str, adapter_import: str):
    """
    Import a metadata adapter by dotted path and fail fast with a clear error.

    The adapter is expected to implement MetadataSubsystem.
    """
    module_path, _, class_name = adapter_import.rpartition(".")
    if not module_path or not class_name:
        raise RuntimeError(f"Invalid metadata adapter path for {endpoint_name}: {adapter_import}")
    try:
        module = __import__(module_path, fromlist=[class_name])
        adapter_cls = getattr(module, class_name)
    except Exception as exc:  # pragma: no cover - import-time guard
        raise RuntimeError(f"Metadata adapter {adapter_import} required for {endpoint_name} is not available") from exc
    return adapter_cls


class EndpointRegistry:
    """Simple registry for named endpoint factories."""

    def __init__(self) -> None:
        self._sources: Dict[str, Any] = {}
        self._sinks: Dict[str, Any] = {}

    def register_source(self, key: str, factory: Any) -> None:
        self._sources[key.lower()] = factory

    def register_sink(self, key: str, factory: Any) -> None:
        self._sinks[key.lower()] = factory

    def source(self, key: str):
        return self._sources.get(key.lower())

    def sink(self, key: str):
        return self._sinks.get(key.lower())


# global registry instance for convenience
REGISTRY = EndpointRegistry()


@runtime_checkable
class SupportsIngestionUnits(Protocol):
    """Endpoints that can enumerate logical ingestion units/datasets."""

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        ...


@runtime_checkable
class SupportsIncrementalPlanning(Protocol):
    """Endpoints that can plan adaptive incremental slices for units."""

    def plan_incremental_slices(
        self,
        *,
        unit_id: str,
        checkpoint: Optional[Dict[str, Any]],
        limit: Optional[int] = None,
    ) -> List[IngestionSlice]:
        ...


@runtime_checkable
class SupportsIngestionExecution(Protocol):
    """Endpoints that can execute ingestion units directly."""

    def run_ingestion_unit(
        self,
        unit_id: str,
        *,
        endpoint_id: str,
        policy: Dict[str, Any],
        checkpoint: Optional[Dict[str, Any]] = None,
        mode: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        transient_state: Optional[Dict[str, Any]] = None,
    ) -> Any:
        ...


@runtime_checkable
class IngestionCapableEndpoint(SourceEndpoint, SupportsIngestionUnits, SupportsIngestionExecution, Protocol):
    """Source endpoints that expose ingestion units and can execute them."""
    ...


@runtime_checkable
class IncrementalPlanningEndpoint(
    IngestionCapableEndpoint,
    SupportsIncrementalPlanning,
    SupportsIngestionExecution,
    Protocol,
):
    """Ingestion-capable endpoints that can also plan incremental slices."""
    ...
