from __future__ import annotations

from datetime import datetime, UTC

import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "core", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "metadata-gateway", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "metadata-sdk", "src"))

from metadata_sdk import DataVolumeMetric, MetadataClient, MetadataTarget  # noqa: E402


class StubRepository:
    def __init__(self):
        self.records = []

    def store(self, record):
        self.records.append(record)
        return record

    def bulk_store(self, records):
        for record in records:
            self.store(record)
        return list(records)

    def latest(self, target, kind=None):  # pragma: no cover - unused
        return None

    def history(self, target, kind=None, limit=None):  # pragma: no cover - unused
        return []

    def query(self, query):  # pragma: no cover - unused
        return []


class StubGateway:
    def __init__(self):
        self.emitted = []

    def emit(self, context, record):
        self.emitted.append(record)

    def emit_many(self, context, records):  # pragma: no cover - unused
        for record in records:
            self.emit(context, record)


def test_metadata_client_emit_uses_gateway():
    repo = StubRepository()
    gateway = StubGateway()
    client = MetadataClient.with_embedded(repo, gateway=gateway, source_id="test")
    record = DataVolumeMetric(
        target=MetadataTarget(source_id="test", namespace="FOO", entity="BAR"),
        payload={},
        rows=10,
        produced_at=datetime.now(UTC),
    )

    client.ingestion.emit_volume(record)

    assert gateway.emitted, "Gateway should capture emitted record"
    assert gateway.emitted[0].payload["rows"] == 10
