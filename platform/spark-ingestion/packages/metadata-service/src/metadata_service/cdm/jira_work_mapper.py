"""Pure helper functions to map normalized Jira records into CDM work models."""

from datetime import datetime
from typing import Any, Dict, Optional

from runtime_core.cdm import (
    CdmWorkComment,
    CdmWorkItem,
    CdmWorkLog,
    CdmWorkProject,
    CdmWorkUser,
)


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def map_jira_project_to_cdm(project: Dict[str, Any], *, source_system: str = "jira") -> CdmWorkProject:
    cdm_id = f"cdm:work:project:{source_system}:{project.get('key')}"
    return CdmWorkProject(
        cdm_id=cdm_id,
        source_system=source_system,
        source_project_key=str(project.get("key") or ""),
        name=str(project.get("name") or ""),
        description=project.get("description"),
        url=project.get("self"),
        properties={
            "projectType": project.get("projectTypeKey"),
            "lead": project.get("lead"),
            "category": project.get("projectCategory"),
        },
    )


def map_jira_user_to_cdm(user: Dict[str, Any], *, source_system: str = "jira") -> CdmWorkUser:
    account_id = str(user.get("accountId") or "")
    cdm_id = f"cdm:work:user:{source_system}:{account_id}"
    return CdmWorkUser(
        cdm_id=cdm_id,
        source_system=source_system,
        source_user_id=account_id,
        display_name=str(user.get("displayName") or account_id),
        email=user.get("emailAddress"),
        active=user.get("active"),
        properties={
            "timeZone": user.get("timeZone"),
            "accountType": user.get("accountType"),
        },
    )


def map_jira_issue_to_cdm(issue: Dict[str, Any], *, project_cdm_id: str, source_system: str = "jira") -> CdmWorkItem:
    key = str(issue.get("key") or "")
    cdm_id = f"cdm:work:item:{source_system}:{key}"
    fields = issue.get("fields") or {}
    reporter = fields.get("reporter") or {}
    assignee = fields.get("assignee") or {}
    labels = list(fields.get("labels") or [])

    return CdmWorkItem(
        cdm_id=cdm_id,
        source_system=source_system,
        source_issue_key=key,
        project_cdm_id=project_cdm_id,
        reporter_cdm_id=_user_cdm_id(reporter, source_system),
        assignee_cdm_id=_user_cdm_id(assignee, source_system),
        issue_type=_nested_name(fields.get("issuetype")),
        status=_nested_name(fields.get("status")),
        status_category=_nested_name(fields.get("status"), "statusCategory", "name"),
        priority=_nested_name(fields.get("priority")),
        summary=str(fields.get("summary") or ""),
        description=fields.get("description"),
        labels=labels,
        created_at=_parse_datetime(fields.get("created")),
        updated_at=_parse_datetime(fields.get("updated")),
        closed_at=_parse_datetime(fields.get("resolutiondate")),
        properties={
            "rawFields": fields,
        },
    )


def map_jira_comment_to_cdm(
    comment: Dict[str, Any],
    *,
    item_cdm_id: str,
    source_system: str = "jira",
) -> CdmWorkComment:
    comment_id = str(comment.get("id") or "")
    cdm_id = f"cdm:work:comment:{source_system}:{item_cdm_id}:{comment_id}"
    author = comment.get("author") or {}
    return CdmWorkComment(
        cdm_id=cdm_id,
        source_system=source_system,
        source_comment_id=comment_id,
        item_cdm_id=item_cdm_id,
        author_cdm_id=_user_cdm_id(author, source_system),
        body=str(comment.get("body") or ""),
        created_at=_parse_datetime(comment.get("created")),
        updated_at=_parse_datetime(comment.get("updated")),
        visibility=_nested_name(comment.get("visibility")),
        properties={
            "raw": comment,
        },
    )


def map_jira_worklog_to_cdm(
    worklog: Dict[str, Any],
    *,
    item_cdm_id: str,
    source_system: str = "jira",
) -> CdmWorkLog:
    worklog_id = str(worklog.get("id") or "")
    cdm_id = f"cdm:work:worklog:{source_system}:{item_cdm_id}:{worklog_id}"
    author = worklog.get("author") or {}
    return CdmWorkLog(
        cdm_id=cdm_id,
        source_system=source_system,
        source_worklog_id=worklog_id,
        item_cdm_id=item_cdm_id,
        author_cdm_id=_user_cdm_id(author, source_system),
        started_at=_parse_datetime(worklog.get("started")),
        time_spent_seconds=worklog.get("timeSpentSeconds"),
        comment=worklog.get("comment"),
        visibility=_nested_name(worklog.get("visibility")),
        properties={
            "raw": worklog,
        },
    )


def _user_cdm_id(user: Dict[str, Any], source_system: str) -> Optional[str]:
    account_id = user.get("accountId")
    if not account_id:
        return None
    return f"cdm:work:user:{source_system}:{account_id}"


def _nested_name(obj: Dict[str, Any], *path: str) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    target = obj
    for key in path or ("name",):
        target = target.get(key)
        if target is None:
            return None
    if isinstance(target, str):
        return target
    return None
