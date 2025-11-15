from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "core", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "metadata-sdk", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "runtime-orchestration", "src"))

from runtime_common.events import Event  # noqa: E402
from runtime_common.events.types import EventCategory, EventType  # noqa: E402
from runtime_orchestration.metadata_events import MetadataEventSubscriber  # noqa: E402
from metadata_sdk import DataVolumeMetric, MetadataRecord, MetadataTarget  # noqa: E402


class _StubLogger:
    def __init__(self) -> None:
        self.entries = []

    def warn(self, event, **payload):  # pragma: no cover - fallback logging
        self.entries.append(("warn", event, payload))

    def debug(self, event, **payload):  # pragma: no cover - fallback logging
        self.entries.append(("debug", event, payload))

    def info(self, *args, **kwargs):  # pragma: no cover - unused
        self.entries.append(("info", args, kwargs))


class _StubContext:
    def __init__(self) -> None:
        self.targets = []

    def for_target(self, target):
        self.targets.append(target)
        return {"target": target}


class _StubTransport:
    def __init__(self) -> None:
        self.emitted = []

    def emit(self, context, record):
        self.emitted.append((context, record))


class _StubIngestion:
    def __init__(self) -> None:
        self.volume = []
        self.runtime = []

    def emit_volume(self, metric):
        self.volume.append(metric)

    def emit_runtime(self, metric):
        self.runtime.append(metric)


class _StubGateway:
    def __init__(self) -> None:
        self.calls = []

    def emit(self, context, record):
        self.calls.append((context, record))


class _StubSDK:
    def __init__(self) -> None:
        self.context = _StubContext()
        self.transport = _StubTransport()
        self.ingestion = _StubIngestion()


def test_metadata_metric_routes_through_sdk_volume() -> None:
    logger = _StubLogger()
    sdk = _StubSDK()
    subscriber = MetadataEventSubscriber(logger, metadata_sdk=sdk)
    target = MetadataTarget(source_id="src", namespace="FOO", entity="BAR")
    record = MetadataRecord(
        target=target,
        kind="ingestion_volume",
        payload={"rows": 5},
        produced_at=datetime.now(timezone.utc),
        producer_id="test",
    )
    event = Event(
        category=EventCategory.METADATA,
        type=EventType.METADATA_METRIC,
        payload={
            "metric_kind": "ingestion_volume",
            "target": target,
            "produced_at": record.produced_at,
            "record": record,
            "metric_payload": {"rows": 5, "mode": "full", "load_date": "2024-01-01", "extras": {}},
        },
    )

    subscriber.on_event(event)

    assert len(sdk.ingestion.volume) == 1
    metric = sdk.ingestion.volume[0]
    assert isinstance(metric, DataVolumeMetric)
    assert metric.rows == 5
    assert sdk.transport.emitted == []


def test_metadata_record_falls_back_to_gateway() -> None:
    logger = _StubLogger()
    gateway = _StubGateway()
    subscriber = MetadataEventSubscriber(logger, metadata_gateway=gateway)
    target = MetadataTarget(source_id="src", namespace="FOO", entity="BAR")
    record = MetadataRecord(
        target=target,
        kind="schema_snapshot",
        payload={"columns": []},
        produced_at=datetime.now(timezone.utc),
        producer_id="test",
    )
    event = Event(
        category=EventCategory.METADATA,
        type=EventType.METADATA_RECORD,
        payload={"record": record},
    )

    subscriber.on_event(event)

    assert len(gateway.calls) == 1
    ctx, emitted = gateway.calls[0]
    assert emitted is record
    assert ctx.source_id == "src"
    assert ctx.namespace == "FOO"
