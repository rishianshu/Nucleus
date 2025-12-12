from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

CDM_WORK_PROJECT = "cdm.work.project"
CDM_WORK_USER = "cdm.work.user"
CDM_WORK_ITEM = "cdm.work.item"
CDM_WORK_COMMENT = "cdm.work.comment"
CDM_WORK_LOG = "cdm.work.worklog"


@dataclass(frozen=True)
class CdmWorkProject:
    cdm_id: str
    source_system: str
    source_project_key: str
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmWorkUser:
    cdm_id: str
    source_system: str
    source_user_id: str
    display_name: str
    email: Optional[str] = None
    active: Optional[bool] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmWorkItem:
    cdm_id: str
    source_system: str
    source_id: str
    source_issue_key: str
    project_cdm_id: str
    reporter_cdm_id: Optional[str]
    assignee_cdm_id: Optional[str]
    issue_type: Optional[str]
    status: Optional[str]
    status_category: Optional[str]
    priority: Optional[str]
    summary: str
    description: Optional[str]
    source_url: Optional[str] = None
    labels: List[str] = field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    raw_source: Optional[Dict[str, Any]] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmWorkComment:
    cdm_id: str
    source_system: str
    source_comment_id: str
    item_cdm_id: str
    author_cdm_id: Optional[str]
    body: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    visibility: Optional[str] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmWorkLog:
    cdm_id: str
    source_system: str
    source_worklog_id: str
    item_cdm_id: str
    author_cdm_id: Optional[str]
    started_at: Optional[datetime]
    time_spent_seconds: Optional[int]
    comment: Optional[str] = None
    visibility: Optional[str] = None
    properties: Dict[str, Any] = field(default_factory=dict)
