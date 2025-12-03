from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src", "metadata-service/src"):
    sys.path.insert(0, str(PACKAGES / rel))

_WORKER_PATH = ROOT / "temporal" / "metadata_worker.py"
_SPEC = importlib.util.spec_from_file_location("metadata_worker_test_module", _WORKER_PATH)
assert _SPEC and _SPEC.loader
metadata_worker = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = metadata_worker
_SPEC.loader.exec_module(metadata_worker)  # type: ignore[arg-type]


class FakeSubsystem:
    def __init__(self, params):
        self.params = params

    def preview_dataset(self, *, dataset_id: str, limit: int, config=None):  # type: ignore[override]
        return [
            {
                "dataset": dataset_id,
                "limit": limit,
                "token": self.params.get("api_token"),
            }
        ]


class FakeEndpoint:
    def __init__(self, tool, endpoint_cfg, table_cfg):
        self.tool = tool
        self.endpoint_cfg = endpoint_cfg
        self.table_cfg = table_cfg

    def metadata_subsystem(self):
        return FakeSubsystem(self.endpoint_cfg)


def test_decode_preview_payload_round_trip():
    payload = {"templateId": "jira.http", "parameters": {"api_token": "abc"}}
    encoded = json.dumps(payload)
    decoded = metadata_worker._decode_preview_payload(encoded)
    assert decoded == payload


def test_preview_endpoint_dataset_invokes_subsystem(monkeypatch: pytest.MonkeyPatch):
    request = metadata_worker.PreviewRequest(
        datasetId="jira.issues",
        endpointId="endpoint-1",
        unitId="jira.issues",
        schema="jira",
        table="issues",
        connectionUrl="",
        limit=10,
    )
    payload = {"templateId": "jira.http", "parameters": {"api_token": "abc"}, "datasetId": "jira.issues"}

    monkeypatch.setattr(metadata_worker, "get_endpoint_class", lambda template_id: FakeEndpoint)

    result = metadata_worker._preview_endpoint_dataset(request, payload)
    assert result["rows"] == [
        {"dataset": "jira.issues", "limit": 10, "token": "abc"}
    ]
    assert "sampledAt" in result
