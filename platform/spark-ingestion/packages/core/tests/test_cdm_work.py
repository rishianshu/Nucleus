from datetime import datetime, timezone

from runtime_core.cdm import (
    CDM_WORK_COMMENT,
    CDM_WORK_ITEM,
    CDM_WORK_LOG,
    CDM_WORK_PROJECT,
    CDM_WORK_USER,
    CdmWorkComment,
    CdmWorkItem,
    CdmWorkLog,
    CdmWorkProject,
    CdmWorkUser,
)


def test_cdm_work_project_defaults():
    project = CdmWorkProject(
        cdm_id="cdm:work:project:jira:ENG",
        source_system="jira",
        source_project_key="ENG",
        name="Engineering",
        description="Core engineering project",
        url="https://jira.example.com/projects/ENG",
        properties={"category": "software"},
    )
    assert project.cdm_id.startswith("cdm:work:project")
    assert project.properties["category"] == "software"


def test_cdm_work_user_defaults():
    user = CdmWorkUser(
        cdm_id="cdm:work:user:jira:abc123",
        source_system="jira",
        source_user_id="abc123",
        display_name="Jane Doe",
        email="jane@example.com",
        active=True,
        properties={"timezone": "UTC"},
    )
    assert user.active is True
    assert user.properties["timezone"] == "UTC"


def test_cdm_work_item_with_dates():
    now = datetime.now(timezone.utc)
    item = CdmWorkItem(
        cdm_id="cdm:work:item:jira:ENG-123",
        source_system="jira",
        source_issue_key="ENG-123",
        project_cdm_id="cdm:work:project:jira:ENG",
        reporter_cdm_id="cdm:work:user:jira:rep",
        assignee_cdm_id=None,
        issue_type="Bug",
        status="In Progress",
        status_category="IN_PROGRESS",
        priority="High",
        summary="Sample bug",
        description="Steps to reproduce...",
        labels=["regression"],
        created_at=now,
        updated_at=now,
        closed_at=None,
        properties={"severity": "S1"},
    )
    assert item.labels == ["regression"]
    assert item.properties["severity"] == "S1"


def test_cdm_work_comment_and_log():
    comment = CdmWorkComment(
        cdm_id="cdm:work:comment:jira:ENG-1:2",
        source_system="jira",
        source_comment_id="2",
        item_cdm_id="cdm:work:item:jira:ENG-1",
        author_cdm_id="cdm:work:user:jira:abc",
        body="Looks good",
        created_at=None,
        updated_at=None,
        visibility="public",
        properties={},
    )
    assert comment.visibility == "public"

    worklog = CdmWorkLog(
        cdm_id="cdm:work:worklog:jira:ENG-1:5",
        source_system="jira",
        source_worklog_id="5",
        item_cdm_id="cdm:work:item:jira:ENG-1",
        author_cdm_id="cdm:work:user:jira:abc",
        started_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        time_spent_seconds=3600,
        comment="Investigated root cause",
        visibility=None,
        properties={"billing_code": "R&D"},
    )
    assert worklog.time_spent_seconds == 3600
    assert worklog.properties["billing_code"] == "R&D"


def test_cdm_constants_exposed():
    assert CDM_WORK_PROJECT == "cdm.work.project"
    assert CDM_WORK_USER == "cdm.work.user"
    assert CDM_WORK_ITEM == "cdm.work.item"
    assert CDM_WORK_COMMENT == "cdm.work.comment"
    assert CDM_WORK_LOG == "cdm.work.worklog"
