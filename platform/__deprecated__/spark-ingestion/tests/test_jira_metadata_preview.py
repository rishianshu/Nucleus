from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
sys.path.insert(0, str(PACKAGES / "metadata-service" / "src"))
sys.path.insert(0, str(PACKAGES / "runtime-common" / "src"))

# Ensure local metadata_service module is used in tests.
for module_name in list(sys.modules):
    if module_name.startswith("metadata_service"):
        sys.modules.pop(module_name)

import endpoint_service.endpoints.jira.metadata as jira_adapter
from endpoint_service.endpoints.jira.metadata import JiraMetadataSubsystem


class StubJiraRuntime:
    def __init__(self):
        self.session = SimpleNamespace(close=lambda: None)

    def _build_jira_session(self, params):
        return self.session

    def _sync_jira_projects(self, *args, **kwargs):
        return ([{"payload": {"projectKey": "ENG", "name": "Engineering"}}], {})

    def _sync_jira_issues(self, *args, **kwargs):
        return ([{"payload": {"issueKey": "ENG-1", "summary": "Test"}}], {})

    def _sync_jira_users(self, *args, **kwargs):
        return ([{"payload": {"accountId": "user-1", "displayName": "Alice"}}], {})

    def _sync_jira_comments(self, *args, **kwargs):
        return ([{"payload": {"commentId": "c-1", "body": "Thanks"}}], {})

    def _sync_jira_worklogs(self, *args, **kwargs):
        return ([{"payload": {"worklogId": "w-1", "timeSpentSeconds": 600}}], {})

    def _jira_get(self, session, base_url, path, params=None):
        if path.endswith("/status"):
            return [
                {
                    "id": "1",
                    "name": "To Do",
                    "description": "Open work",
                    "statusCategory": {"name": "To Do", "key": "todo", "colorName": "blue"},
                }
            ]
        if path.endswith("/priority"):
            return [
                {
                    "id": "10",
                    "name": "High",
                    "description": "High priority",
                    "color": "red",
                }
            ]
        if path.endswith("/issuetype"):
            return [
                {
                    "id": "10000",
                    "name": "Task",
                    "description": "Generic task",
                    "hierarchyLevel": 0,
                    "subtask": False,
                    "iconUrl": "https://example/icon.png",
                }
            ]
        return []


@pytest.fixture(autouse=True)
def stub_runtime(monkeypatch: pytest.MonkeyPatch):
    stub = StubJiraRuntime()
    monkeypatch.setattr(jira_adapter, "jira_runtime", stub)
    return stub


def build_subsystem():
    endpoint = SimpleNamespace(
        endpoint_cfg={"base_url": "https://example.atlassian.net", "username": "alice", "api_token": "token"},
        table_cfg={"dataset": "jira.projects"},
        describe=lambda: {"title": "Jira", "domain": "work.jira"},
        descriptor=lambda: SimpleNamespace(id="jira.http"),
    )
    return JiraMetadataSubsystem(endpoint)


def test_preview_accepts_catalog_dataset_identifier():
    subsystem = build_subsystem()
    dataset_record_id = "dataset::dev::global::endpoint::jira::jira-projects"
    rows = subsystem.preview_dataset(dataset_record_id, limit=1, config={})
    assert rows[0]["projectKey"] == "ENG"


def test_preview_returns_reference_rows_for_statuses():
    subsystem = build_subsystem()
    rows = subsystem.preview_dataset("jira.statuses", limit=1, config={})
    assert rows[0]["statusId"] == "1"
    assert rows[0]["categoryColor"] == "blue"


def test_preview_handles_api_surface_dataset_identifier():
    subsystem = build_subsystem()
    dataset_record_id = "dataset::dev::global::endpoint::jira::jira-api-surface"
    rows = subsystem.preview_dataset(dataset_record_id, limit=5, config={})
    assert rows, "Expected api surface preview rows"
    assert {"method", "path", "docUrl"} <= set(rows[0].keys())
