import datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_SERVICE_SRC = ROOT / "packages" / "metadata-service" / "src"
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
sys.path.insert(0, str(METADATA_SERVICE_SRC))
sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from metadata_service.cdm import jira_work_mapper

PROJECT_SAMPLE = {
    "id": "100",
    "key": "ENG",
    "name": "Engineering",
    "description": "Core platform",
    "self": "https://example.atlassian.net/rest/api/3/project/100",
    "projectTypeKey": "software",
    "lead": {"displayName": "Alice"},
    "projectCategory": {"name": "Product"},
}

USER_SAMPLE = {
    "accountId": "user-123",
    "displayName": "Jane Doe",
    "emailAddress": "jane@example.com",
    "active": True,
    "timeZone": "UTC",
    "accountType": "atlassian",
}

ISSUE_SAMPLE = {
    "id": "10001",
    "key": "ENG-42",
    "self": "https://example.atlassian.net/rest/api/3/issue/10001",
    "fields": {
        "summary": "Fix bug",
        "description": "Detailed doc",
        "reporter": USER_SAMPLE,
        "assignee": USER_SAMPLE,
        "labels": ["bug", "priority"],
        "created": "2024-01-01T10:00:00.000Z",
        "updated": "2024-01-02T10:00:00.000Z",
        "resolutiondate": "2024-01-03T10:00:00.000Z",
        "issuetype": {"name": "Bug"},
        "status": {"name": "Done", "statusCategory": {"name": "Complete"}},
        "priority": {"name": "High"},
    },
}

COMMENT_SAMPLE = {
    "id": "comment-1",
    "author": USER_SAMPLE,
    "body": "Looks good",
    "created": "2024-01-04T10:00:00.000Z",
    "updated": "2024-01-05T10:00:00.000Z",
    "visibility": {"name": "public"},
}

WORKLOG_SAMPLE = {
    "id": "log-1",
    "author": USER_SAMPLE,
    "started": "2024-01-06T10:00:00.000Z",
    "timeSpentSeconds": 3600,
    "comment": "1h fix",
    "visibility": {"name": "shared"},
}


def test_project_mapping():
    project = jira_work_mapper.map_jira_project_to_cdm(PROJECT_SAMPLE)
    assert project.cdm_id == "cdm:work:project:jira:ENG"
    assert project.source_project_key == "ENG"
    assert project.name == "Engineering"
    assert project.properties["projectType"] == "software"


def test_user_mapping():
    user = jira_work_mapper.map_jira_user_to_cdm(USER_SAMPLE)
    assert user.cdm_id == "cdm:work:user:jira:user-123"
    assert user.display_name == "Jane Doe"
    assert user.properties["timeZone"] == "UTC"


def test_issue_mapping():
    project = jira_work_mapper.map_jira_project_to_cdm(PROJECT_SAMPLE)
    issue = jira_work_mapper.map_jira_issue_to_cdm(ISSUE_SAMPLE, project_cdm_id=project.cdm_id)
    assert issue.cdm_id == "cdm:work:item:jira:ENG-42"
    assert issue.project_cdm_id == project.cdm_id
    assert issue.source_id == "10001"
    assert issue.source_url == "https://example.atlassian.net/browse/ENG-42"
    assert issue.reporter_cdm_id == "cdm:work:user:jira:user-123"
    assert issue.labels == ["bug", "priority"]
    assert issue.created_at == datetime.datetime(2024, 1, 1, 10, 0, tzinfo=datetime.timezone.utc)
    assert issue.status_category == "Complete"
    assert issue.raw_source["fields"]["summary"] == "Fix bug"


def test_comment_mapping():
    item_cdm_id = "cdm:work:item:jira:ENG-42"
    comment = jira_work_mapper.map_jira_comment_to_cdm(COMMENT_SAMPLE, item_cdm_id=item_cdm_id)
    assert comment.cdm_id == f"cdm:work:comment:jira:{item_cdm_id}:comment-1"
    assert comment.author_cdm_id == "cdm:work:user:jira:user-123"
    assert comment.visibility == "public"


def test_worklog_mapping():
    item_cdm_id = "cdm:work:item:jira:ENG-42"
    worklog = jira_work_mapper.map_jira_worklog_to_cdm(WORKLOG_SAMPLE, item_cdm_id=item_cdm_id)
    assert worklog.cdm_id == f"cdm:work:worklog:jira:{item_cdm_id}:log-1"
    assert worklog.time_spent_seconds == 3600
    assert worklog.started_at == datetime.datetime(2024, 1, 6, 10, 0, tzinfo=datetime.timezone.utc)
