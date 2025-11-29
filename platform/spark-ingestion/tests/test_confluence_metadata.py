import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
sys.path.insert(0, str(PACKAGES / "metadata-service" / "src"))
sys.path.insert(0, str(PACKAGES / "runtime-common" / "src"))
sys.path.insert(0, str(PACKAGES / "metadata-gateway" / "src"))

import pytest

# Ensure local metadata_service implementation is loaded instead of any site-installed version.
for module_name in list(sys.modules):
    if module_name.startswith("metadata_service"):
        sys.modules.pop(module_name)

import metadata_service.adapters.confluence as confluence_adapter
from metadata_service.adapters.confluence import ConfluenceMetadataSubsystem
from runtime_common.endpoints.confluence_http import ConfluenceEndpoint
from runtime_common.endpoints import confluence_http as confluence_runtime_module


class StubRuntime:
    _render_page_preview = staticmethod(confluence_runtime_module._render_page_preview)
    _normalize_confluence_parameters = staticmethod(confluence_runtime_module._normalize_confluence_parameters)

    def __init__(self) -> None:
        self.session = SimpleNamespace(close=lambda: None)

    def _build_confluence_session(self, params):
        return self.session

    def _confluence_get(self, session, base_url, path, params=None):
        if path.startswith("/wiki/rest/api/settings/systemInfo"):
            return {"versionNumber": "8.0.0"}
        if path.startswith("/wiki/rest/api/user/current"):
            return {"accountId": "user-1", "displayName": "Alice", "email": "alice@example.com"}
        if path.startswith("/wiki/rest/api/space"):
            return {
                "results": [
                    {
                        "key": "ENG",
                        "name": "Engineering",
                        "type": "global",
                        "status": "current",
                        "_links": {"base": "https://example.atlassian.net/wiki", "webui": "/spaces/ENG"},
                        "description": {"plain": {"value": "Engineering space"}},
                    }
                ]
            }
        if path.startswith("/wiki/rest/api/content") and "child/attachment" not in path:
            return {
                "results": [
                    {
                        "id": "123",
                        "title": "Onboarding",
                        "space": {"key": "ENG"},
                        "version": {"when": "2024-01-02T10:00:00.000Z", "by": {"displayName": "Bob"}},
                        "body": {"storage": {"value": "<p>Hello</p>"}},
                        "_links": {"base": "https://example.atlassian.net/wiki", "webui": "/spaces/ENG/pages/123"},
                    }
                ]
            }
        if "child/attachment" in path:
            return {
                "results": [
                    {
                        "id": "att-1",
                        "title": "diagram.png",
                        "extensions": {"fileSize": 2048},
                        "metadata": {"mediaType": "image/png"},
                        "version": {"when": "2024-01-03T10:00:00.000Z", "by": {"displayName": "Carol"}},
                        "_links": {"download": "/download/attachments/att-1"},
                    }
                ]
            }
        return {}


@pytest.fixture(autouse=True)
def stub_runtime(monkeypatch):
    stub = StubRuntime()
    monkeypatch.setattr(confluence_adapter, "confluence_runtime", stub)
    return stub


def build_endpoint():
    return ConfluenceEndpoint(
        tool=None,
        endpoint_cfg={"base_url": "https://example.atlassian.net/wiki", "username": "alice", "api_token": "token"},
        table_cfg={"schema": "confluence", "table": "space"},
    )


def test_confluence_probe_and_snapshot(stub_runtime):
    endpoint = build_endpoint()
    subsystem = endpoint.metadata_subsystem()
    assert isinstance(subsystem, ConfluenceMetadataSubsystem)
    environment = subsystem.probe_environment(config={})
    assert environment["authenticated_user"]["displayName"] == "Alice"
    snapshot = subsystem.collect_snapshot(config={"dataset": "confluence.space"}, environment=environment)
    assert snapshot.dataset.name == "Confluence Spaces"
    assert snapshot.schema_fields[0].name == "spaceKey"


def test_confluence_preview_rows(stub_runtime):
    endpoint = build_endpoint()
    subsystem = endpoint.metadata_subsystem()
    rows = subsystem.preview_dataset("confluence.page", limit=1, config={})
    assert rows[0]["pageId"] == "123"
    assert "excerpt" in rows[0]
    attachments = subsystem.preview_dataset("confluence.attachment", limit=1, config={})
    assert attachments[0]["attachmentId"] == "att-1"
