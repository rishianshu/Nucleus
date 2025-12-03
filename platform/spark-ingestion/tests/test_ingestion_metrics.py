from __future__ import annotations
from metadata_service.ingestion.strategies import ExecutionContext
from metadata_service.ingestion.runtime import _maybe_emit_ingestion_metrics, _maybe_emit_metadata
from endpoint_service.events.types import EventCategory, EventType


class _StubCacheCfg:
    def __init__(self) -> None:
        self.source_id = "test-source"


class _StubCacheManager:
    def __init__(self) -> None:
        self.cfg = _StubCacheCfg()


class _StubMetadataAccess:
    def __init__(self) -> None:
        self.cache_manager = _StubCacheManager()
        self.schema_policy = None
        self.schema_validator = None

    def snapshot_for(self, *_args, **_kwargs):  # pragma: no cover - unused
        return None


class _RecorderEmitter:
    def __init__(self) -> None:
        self.events = []

    def emit(self, event):
        self.events.append(event)


def _make_context(flags) -> tuple[ExecutionContext, _RecorderEmitter]:
    emitter = _RecorderEmitter()
    metadata_access = _StubMetadataAccess()
    context = ExecutionContext(
        emitter=emitter,
        metadata_access=metadata_access,
        metadata_gateway=object(),  # ensure feature gate sees a backend
        metadata_feature_flags=flags,
    )
    return context, emitter


def test_ingestion_metrics_emitted_when_flag_enabled() -> None:
    context, emitter = _make_context({"ingestion_metrics": True})

    _maybe_emit_ingestion_metrics(
        context=context,
        schema="foo",
        table="bar",
        mode="full",
        load_date="2024-01-01",
        rows=42,
        result={"raw": "/tmp/raw", "rows": 42},
    )

    assert len(emitter.events) == 1
    event = emitter.events[0]
    assert event.category == EventCategory.METADATA
    assert event.type == EventType.METADATA_METRIC
    record = event.payload["record"]
    assert record.kind == "ingestion_volume"
    assert record.payload["rows"] == 42
    metric_payload = event.payload["metric_payload"]
    assert metric_payload["rows"] == 42
    assert metric_payload["mode"] == "full"


def test_metadata_emitted_for_failure() -> None:
    context, emitter = _make_context({"metadata": True})

    _maybe_emit_metadata(
        context=context,
        schema="foo",
        table="bar",
        mode="scd1",
        load_date="2024-01-02",
        duration=1.234,
        status="failure",
        error="boom",
    )

    assert len(emitter.events) == 1
    event = emitter.events[0]
    assert event.category == EventCategory.METADATA
    assert event.type == EventType.METADATA_METRIC
    record = event.payload["record"]
    assert record.kind == "metadata"
    assert record.payload["status"] == "failure"
    metric_payload = event.payload["metric_payload"]
    assert metric_payload["status"] == "failure"
    assert metric_payload["error"] == "boom"
