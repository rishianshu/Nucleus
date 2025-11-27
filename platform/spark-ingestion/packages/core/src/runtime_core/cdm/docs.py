from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

CDM_DOC_SPACE = "cdm.doc.space"
CDM_DOC_ITEM = "cdm.doc.item"
CDM_DOC_REVISION = "cdm.doc.revision"
CDM_DOC_LINK = "cdm.doc.link"


@dataclass(frozen=True)
class CdmDocSpace:
    cdm_id: str
    source_system: str
    source_space_id: str
    key: Optional[str]
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmDocItem:
    cdm_id: str
    source_system: str
    source_item_id: str
    space_cdm_id: str
    parent_item_cdm_id: Optional[str]
    title: str
    doc_type: Optional[str]
    mime_type: Optional[str]
    created_by_cdm_id: Optional[str]
    updated_by_cdm_id: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    url: Optional[str]
    tags: List[str] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmDocRevision:
    cdm_id: str
    source_system: str
    source_revision_id: str
    item_cdm_id: str
    revision_number: Optional[int]
    revision_label: Optional[str]
    author_cdm_id: Optional[str]
    created_at: Optional[datetime]
    summary: Optional[str]
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CdmDocLink:
    cdm_id: str
    source_system: str
    source_link_id: str
    from_item_cdm_id: str
    to_item_cdm_id: Optional[str]
    url: Optional[str]
    link_type: Optional[str]
    created_at: Optional[datetime]
    properties: Dict[str, Any] = field(default_factory=dict)
