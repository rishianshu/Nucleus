from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src", "metadata-service/src", "metadata-gateway/src"):
    sys.path.insert(0, str(PACKAGES / rel))

from metadata_service.planning import plan_metadata_jobs


class StubLogger:
    def __init__(self) -> None:
        self.events = []

    def info(self, message: str | None = None, **fields):
        self.events.append(("info", message, fields))

    def warn(self, message: str | None = None, **fields):
        self.events.append(("warn", message, fields))

    def error(self, message: str | None = None, **fields):  # pragma: no cover - not used in tests
        self.events.append(("error", message, fields))


def _make_request(**overrides):
    base = {
        "runId": "run-1",
        "endpointId": "endpoint-1",
        "sourceId": "source-1",
        "endpointName": "Test Endpoint",
        "connectionUrl": "postgresql://user:pass@localhost:5432/demo",
        "schemas": ["public"],
        "projectId": "proj-1",
        "labels": ["demo"],
        "config": {"templateId": "jdbc.postgres", "parameters": {}},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_plan_metadata_jobs_for_jira():
    request = _make_request(
        connectionUrl="https://example.atlassian.net",
        config={"templateId": "jira.http", "parameters": {"username": "bot", "api_token": "abc"}},
    )
    plan = plan_metadata_jobs(request, StubLogger())
    assert plan.jobs, "Expected planner to emit Jira metadata jobs"
    datasets = {job.artifact.get("dataset") for job in plan.jobs}
    assert "jira.issues" in datasets
    assert "jira.projects" in datasets


def test_plan_metadata_jobs_for_jdbc(monkeypatch):
    request = _make_request()
    stopped = {"value": False}

    class StubTool:
        def stop(self):
            stopped["value"] = True

    def fake_build_tool(_url):
        return StubTool()

    def fake_expand_tables(_tool, schemas):
        assert schemas == ["public"]
        return [{"schema": "public", "table": "customers"}]

    class FakeEndpoint:
        def __init__(self, table_cfg):
            self.table_cfg = table_cfg
            self.tool = object()

        def configure(self, table_cfg):  # pragma: no cover - unused
            self.table_cfg = table_cfg

        def capabilities(self):  # pragma: no cover - unused in planner
            return None

        def describe(self):  # pragma: no cover - unused
            return {}

        def read_full(self):  # pragma: no cover - unused
            return []

        def read_slice(self, *, lower, upper):  # pragma: no cover - unused
            return []

        def count_between(self, *, lower, upper):  # pragma: no cover - unused
            return 0

        def metadata_subsystem(self):
            return object()

    def fake_build_source(cfg, table_cfg, tool, metadata=None, emitter=None):
        return FakeEndpoint(table_cfg)

    monkeypatch.setattr("metadata_service.planning._build_sqlalchemy_tool", fake_build_tool)
    monkeypatch.setattr("metadata_service.planning._expand_tables", fake_expand_tables)
    monkeypatch.setattr("metadata_service.planning.EndpointFactory.build_source", fake_build_source)

    plan = plan_metadata_jobs(request, StubLogger())
    assert len(plan.jobs) == 1
    job = plan.jobs[0]
    assert job.artifact["schema"] == "public"
    assert job.artifact["table"] == "customers"
    assert plan.cleanup_callbacks, "Expected JDBC plan to register cleanup callbacks"

    # Ensure cleanup callback stops the tool
    for callback in plan.cleanup_callbacks:
        callback()
    assert stopped["value"] is True
