from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src", "metadata-service/src", "metadata-gateway/src"):
    sys.path.insert(0, str(PACKAGES / rel))

from metadata_service.adapters.postgres import PostgresMetadataSubsystem
from metadata_service.planning import (
    MetadataConfigValidationResult,
    MetadataPlanningResult,
    plan_metadata_jobs,
)


class StubLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, str | None, dict]] = []

    def info(self, message: str | None = None, **fields):
        self.events.append(("info", message, {"event": fields.get("event"), **fields}))

    def warn(self, message: str | None = None, **fields):
        self.events.append(("warn", message, {"event": fields.get("event"), **fields}))

    def error(self, message: str | None = None, **fields):
        self.events.append(("error", message, {"event": fields.get("event"), **fields}))


def _make_request(**overrides):
    base = {
        "config": {"templateId": "fake.template", "parameters": {}},
        "connectionUrl": "https://example.net",
        "endpointId": "endpoint-1",
        "sourceId": "source-1",
        "projectId": "proj-1",
        "endpointName": "Test Endpoint",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class FakeSubsystem:
    def __init__(self) -> None:
        self.validated = False
        self.planned = False

    def validate_metadata_config(self, *, parameters):
        self.validated = True
        params = dict(parameters)
        params["normalized"] = True
        return MetadataConfigValidationResult(ok=True, normalized_parameters=params)

    def plan_metadata_jobs(self, *, parameters, request, logger):
        assert parameters.get("normalized") is True
        self.planned = True
        return MetadataPlanningResult(jobs=[])


def test_plan_metadata_jobs_uses_subsystem_hooks(monkeypatch):
    subsystem = FakeSubsystem()

    class FakeEndpoint:
        def __init__(self, tool, endpoint_cfg, table_cfg):
            self.endpoint_cfg = endpoint_cfg
            self.table_cfg = table_cfg

        def metadata_subsystem(self):
            return subsystem

    monkeypatch.setattr("metadata_service.planning.get_endpoint_class", lambda template_id: FakeEndpoint)
    logger = StubLogger()
    result = plan_metadata_jobs(_make_request(), logger)
    assert isinstance(result, MetadataPlanningResult)
    assert subsystem.validated and subsystem.planned


def test_plan_metadata_jobs_logs_validation_failure(monkeypatch):
    class FailingSubsystem:
        def validate_metadata_config(self, *, parameters):
            return MetadataConfigValidationResult(ok=False, errors=["missing base_url"])

    class FakeEndpoint:
        def __init__(self, tool, endpoint_cfg, table_cfg):
            pass

        def metadata_subsystem(self):
            return FailingSubsystem()

    monkeypatch.setattr("metadata_service.planning.get_endpoint_class", lambda template_id: FakeEndpoint)
    logger = StubLogger()
    result = plan_metadata_jobs(_make_request(), logger)
    assert result.jobs == []
    assert any(fields.get("event") == "metadata_config_invalid" for _, _, fields in logger.events)


def test_plan_metadata_jobs_logs_when_unsupported(monkeypatch):
    class NoSubsystemEndpoint:
        def __init__(self, tool, endpoint_cfg, table_cfg):
            pass

        def metadata_subsystem(self):
            return None

    monkeypatch.setattr("metadata_service.planning.get_endpoint_class", lambda template_id: NoSubsystemEndpoint)
    logger = StubLogger()
    result = plan_metadata_jobs(_make_request(), logger)
    assert result.jobs == []
    assert any(fields.get("event") == "metadata_planning_unsupported" for _, _, fields in logger.events)


def test_postgres_subsystem_delegates_to_jdbc_helper(monkeypatch):
    sentinel = MetadataPlanningResult(jobs=["job"])

    def fake_plan(parameters, request, logger):
        return sentinel

    adapters_postgres = importlib.import_module("metadata_service.adapters.postgres")
    monkeypatch.setattr(adapters_postgres, "plan_jdbc_metadata_jobs", fake_plan)

    class DummyEndpoint:
        schema = "public"
        table = "customers"
        jdbc_cfg: dict = {}
        DIALECT = "postgres"

    subsystem = PostgresMetadataSubsystem(DummyEndpoint())
    request = SimpleNamespace(connectionUrl="postgresql://example", schemas=["public"])
    result = subsystem.plan_metadata_jobs(parameters={}, request=request, logger=StubLogger())
    assert result is sentinel
