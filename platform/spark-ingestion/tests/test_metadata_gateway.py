from __future__ import annotations

import os
import sys
from datetime import datetime
from typing import Iterable, List, Sequence

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "core", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "metadata-gateway", "src"))

from runtime_core import (  # noqa: E402
    MetadataContext,
    MetadataQuery,
    MetadataRecord,
    MetadataRepository,
    MetadataTarget,
)
from metadata_gateway import MetadataGateway  # noqa: E402


class StubRepository(MetadataRepository):
    def __init__(self) -> None:
        self.stored: List[MetadataRecord] = []

    def store(self, record: MetadataRecord) -> MetadataRecord:
        self.stored.append(record)
        return record

    def bulk_store(self, records: Iterable[MetadataRecord]) -> Sequence[MetadataRecord]:
        collected = list(records)
        self.stored.extend(collected)
        return collected

    def latest(self, target: MetadataTarget, kind: str | None = None) -> MetadataRecord | None:
        for record in reversed(self.stored):
            if record.target == target and (kind is None or record.kind == kind):
                return record
        return None

    def history(
        self,
        target: MetadataTarget,
        kind: str | None = None,
        limit: int | None = None,
    ) -> Sequence[MetadataRecord]:
        items = [r for r in self.stored if r.target == target and (kind is None or r.kind == kind)]
        return items[-limit:] if limit is not None else items

    def query(self, criteria: MetadataQuery):
        return list(self.stored)


def _sample_record(kind: str) -> MetadataRecord:
    return MetadataRecord(
        target=MetadataTarget(source_id="unit", namespace="foo", entity="bar"),
        kind=kind,
        payload={},
        produced_at=datetime.utcnow(),
        producer_id="test",
    )


def test_emit_falls_back_to_repository() -> None:
    repo = StubRepository()
    gateway = MetadataGateway(repo)
    ctx = MetadataContext(source_id="unit")
    rec = _sample_record("ingestion_volume")

    gateway.emit(ctx, rec)

    assert repo.stored == [rec]


def test_emit_many_batches_records() -> None:
    repo = StubRepository()
    gateway = MetadataGateway(repo)
    ctx = MetadataContext(source_id="unit")
    r1 = _sample_record("a")
    r2 = _sample_record("b")

    gateway.emit_many(ctx, [r1, r2])

    assert repo.stored == [r1, r2]


def test_latest_and_history_delegate_to_repository() -> None:
    repo = StubRepository()
    gateway = MetadataGateway(repo)
    ctx = MetadataContext(source_id="unit")
    recs = [_sample_record("kind") for _ in range(3)]

    gateway.emit_many(ctx, recs)

    latest = gateway.latest(recs[-1].target, "kind")
    history = gateway.history(recs[-1].target, "kind")

    assert latest == recs[-1]
    assert history == recs
