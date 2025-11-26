from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
RUNTIME_CORE_SRC = ROOT / "packages" / "core" / "src"
sys.path.insert(0, str(RUNTIME_COMMON_SRC))
sys.path.insert(0, str(RUNTIME_CORE_SRC))

from runtime_common.endpoints import jira_http


class DummySession:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def stub_jira_http(monkeypatch):
    payloads = {
        "/rest/api/3/project/search": {
            "values": [
                {
                    "key": "ENG",
                    "name": "Engineering",
                    "projectTypeKey": "software",
                    "lead": {"displayName": "Lead", "accountId": "user-1"},
                }
            ]
        },
        "/rest/api/3/search": {
            "issues": [
                {
                    "id": "1001",
                    "key": "ENG-1",
                    "fields": {
                        "summary": "Issue one",
                        "updated": "2023-01-01T00:00:00.000+0000",
                        "project": {"key": "ENG", "name": "Engineering"},
                        "status": {"name": "To Do", "statusCategory": {"key": "new"}},
                        "assignee": {"accountId": "user-2", "displayName": "Assignee"},
                        "reporter": {"accountId": "user-3", "displayName": "Reporter"},
                    },
                }
            ]
        },
        "/rest/api/3/users/search": [
            {
                "accountId": "user-4",
                "displayName": "User Four",
                "emailAddress": "four@example.com",
            }
        ],
    }

    def fake_session(_params):
        return DummySession()

    def fake_jira_get(_session, _base_url, path, params=None):
        if path == "/rest/api/3/project/search":
            return payloads[path]
        if path == "/rest/api/3/search":
            if params and params.get("startAt", 0) > 0:
                return {"issues": []}
            return payloads[path]
        if path == "/rest/api/3/users/search":
            if params and params.get("startAt", 0) > 0:
                return []
            return payloads[path]
        raise AssertionError(f"Unexpected Jira path: {path}")

    monkeypatch.setattr(jira_http, "_build_jira_session", fake_session)
    monkeypatch.setattr(jira_http, "_jira_get", fake_jira_get)


BASE_POLICY = {
    "base_url": "https://example.atlassian.net",
    "auth_type": "basic",
    "username": "robot@example.com",
    "api_token": "token",
}


def test_projects_unit_uses_catalog_handler():
    result = jira_http.run_jira_ingestion_unit(
        "jira.projects",
        endpoint_id="endpoint-1",
        policy=dict(BASE_POLICY),
        checkpoint=None,
    )
    assert result.records
    assert result.cursor.get("lastRunAt")
    assert result.stats["recordCount"] == 1


def test_issues_unit_uses_catalog_handler():
    result = jira_http.run_jira_ingestion_unit(
        "jira.issues",
        endpoint_id="endpoint-1",
        policy=dict(BASE_POLICY),
        checkpoint={"lastUpdated": "2022-12-31T00:00:00.000+0000"},
    )
    assert result.records
    assert result.cursor["lastUpdated"] == "2023-01-01T00:00:00.000+0000"
    assert result.stats["issuesSynced"] == 1


def test_users_unit_uses_catalog_handler():
    result = jira_http.run_jira_ingestion_unit(
        "jira.users",
        endpoint_id="endpoint-1",
        policy=dict(BASE_POLICY),
        checkpoint=None,
    )
    assert result.records
    assert result.stats["usersSynced"] == 1
