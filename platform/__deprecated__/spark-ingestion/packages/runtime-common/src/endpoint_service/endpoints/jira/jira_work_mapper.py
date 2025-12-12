"""Pure helper functions to map normalized Jira records into CDM work models."""

from urllib.parse import urlparse
from datetime import datetime
from typing import Any, Dict, Optional

from ingestion_models.cdm import (
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
            "raw": project,
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
            "raw": user,
        },
    )


def map_jira_issue_to_cdm(issue: Dict[str, Any], *, project_cdm_id: str, source_system: str = "jira") -> CdmWorkItem:
    key = str(issue.get("key") or "")
    issue_id = str(issue.get("id") or key)
    cdm_id = f"cdm:work:item:{source_system}:{key}"
    fields = issue.get("fields") or {}
    reporter = fields.get("reporter") or {}
    assignee = fields.get("assignee") or {}
    labels = list(fields.get("labels") or [])
    source_url = _build_issue_url(issue.get("self"), key)

    return CdmWorkItem(
        cdm_id=cdm_id,
        source_system=source_system,
        source_id=issue_id,
        source_issue_key=key,
        source_url=source_url,
        project_cdm_id=project_cdm_id,
        reporter_cdm_id=_user_cdm_id(reporter, source_system),
        assignee_cdm_id=_user_cdm_id(assignee, source_system),
        issue_type=_nested_name(fields.get("issuetype") or {}),
        status=_nested_name(fields.get("status") or {}),
        status_category=_nested_name(fields.get("status") or {}, "statusCategory", "name"),
        priority=_nested_name(fields.get("priority") or {}),
        summary=str(fields.get("summary") or ""),
        description=fields.get("description"),
        labels=labels,
        created_at=_parse_datetime(fields.get("created")),
        updated_at=_parse_datetime(fields.get("updated")),
        closed_at=_parse_datetime(fields.get("resolutiondate")),
        raw_source={
            "id": issue_id,
            "key": key,
            "fields": fields,
        },
        properties={
            "rawFields": fields,
            "raw": issue,
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
        visibility=_nested_name(comment.get("visibility") or {}),
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
        visibility=_nested_name(worklog.get("visibility") or {}),
        properties={
            "raw": worklog,
        },
    )


def _user_cdm_id(user: Dict[str, Any], source_system: str) -> Optional[str]:
    account_id = user.get("accountId")
    if not account_id:
        return None
    return f"cdm:work:user:{source_system}:{account_id}"


def _nested_name(obj: Dict[str, Any] | None, *path: str) -> Optional[str]:
    target: Any = obj
    if not isinstance(target, dict):
        return None
    for key in path or ("name",):
        target = target.get(key)
        if target is None:
            return None
    if isinstance(target, str):
        return target
    return None


def _build_issue_url(api_url: Optional[str], key: str) -> Optional[str]:
    if not api_url or not isinstance(api_url, str):
        return None
    try:
        parsed = urlparse(api_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/browse/{key}"
    except Exception:
        return None
    return None
