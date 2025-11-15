from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "metadata-sdk", "src"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "packages", "recon-runtime", "src"))

from recon.context import ReconContext  # noqa: E402
from metadata_sdk import MetadataRecord, MetadataTarget  # noqa: E402


class StubLogger:
    def info(self, *_args, **_kwargs) -> None:
        pass

    def warn(self, *_args, **_kwargs) -> None:
        pass

    def debug(self, *_args, **_kwargs) -> None:  # pragma: no cover - unused
        pass


class StubIngestionService:
    def __init__(self, history_records, runtime_records) -> None:
        self._history_records = history_records
        self._runtime_records = runtime_records
        self.history_calls = []
        self.runtime_calls = []

    def history(self, target, limit=None):
        self.history_calls.append((target, limit))
        return self._history_records

    def runtime_history(self, target, limit=None):
        self.runtime_calls.append((target, limit))
        return self._runtime_records


class StubSDK:
    def __init__(self, history_records, runtime_records) -> None:
        self.ingestion = StubIngestionService(history_records, runtime_records)


class StubRepository:
    def __init__(self, records) -> None:
        self._records = records
        self.calls = []

    def history(self, target, kind=None, limit=None):
        self.calls.append((target, kind, limit))
        return self._records


def _make_record(target: MetadataTarget, kind: str) -> MetadataRecord:
    return MetadataRecord(
        target=target,
        kind=kind,
        payload={},
        produced_at=datetime.now(timezone.utc),
        producer_id="test",
    )


def _make_context(**overrides) -> ReconContext:
    table_cfg = {"schema": "foo", "table": "bar"}
    kwargs = {
        "spark": None,
        "tool": None,
        "cfg": {},
        "table_cfg": table_cfg,
        "logger": StubLogger(),
        "source": object(),
        "target": None,
    }
    kwargs.update(overrides)
    return ReconContext(**kwargs)


def test_recon_context_uses_sdk_for_ingestion_history() -> None:
    target = MetadataTarget(source_id="sdk-source", namespace="FOO", entity="BAR")
    history_record = _make_record(target, "ingestion_volume")
    runtime_record = _make_record(target, "ingestion_runtime")
    sdk = StubSDK([history_record], [runtime_record])
    metadata_access = SimpleNamespace(cache_manager=SimpleNamespace(cfg=SimpleNamespace(source_id="sdk-source")))

    ctx = _make_context(metadata_access=metadata_access, metadata_sdk=sdk)

    history = ctx.ingestion_history(limit=5)
    runtime_history = ctx.ingestion_runtime_history(limit=3)

    assert history == [history_record]
    assert runtime_history == [runtime_record]
    # SDK should receive the limit parameter and uppercase target coordinates
    hist_target, hist_limit = sdk.ingestion.history_calls[0]
    assert (hist_target.namespace, hist_target.entity) == ("FOO", "BAR")
    assert hist_limit == 5
    run_target, run_limit = sdk.ingestion.runtime_calls[0]
    assert (run_target.namespace, run_target.entity) == ("FOO", "BAR")
    assert run_limit == 3


def test_recon_context_falls_back_to_repository_history() -> None:
    target = MetadataTarget(source_id="repo-source", namespace="FOO", entity="BAR")
    repo_records = [_make_record(target, "ingestion_volume"), _make_record(target, "ingestion_runtime")]
    repository = StubRepository(repo_records)
    metadata_access = SimpleNamespace(
        cache_manager=SimpleNamespace(cfg=SimpleNamespace(source_id="repo-source")),
        repository=repository,
    )

    ctx = _make_context(metadata_access=metadata_access, metadata_sdk=None)

    history = ctx.ingestion_history(limit=2)
    runtime_history = ctx.ingestion_runtime_history(limit=1)

    assert history == repo_records
    assert runtime_history == repo_records
    assert repository.calls[0][1] == "ingestion_volume"
    assert repository.calls[1][1] == "ingestion_runtime"
