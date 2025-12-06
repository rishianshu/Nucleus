from __future__ import annotations

from typing import Any, Dict

from ingestion_models.cdm import (
    CDM_DOC_ITEM,
    CDM_DOC_LINK,
    CDM_DOC_SPACE,
)

CONFLUENCE_API_LIBRARY: Dict[str, Dict[str, str]] = {
    "space_search": {
        "method": "GET",
        "path": "/wiki/rest/api/space",
        "description": "List spaces visible to the authenticated account.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-space/#api-space-get",
        "scope": "spaces",
    },
    "space_detail": {
        "method": "GET",
        "path": "/wiki/rest/api/space/{spaceKey}",
        "description": "Fetch a space by key to access metadata and permissions.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-space/#api-space-spacekey-get",
        "scope": "spaces",
    },
    "page_search": {
        "method": "GET",
        "path": "/wiki/rest/api/content",
        "description": "Enumerate pages via cursor pagination and optional space filters.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content/#api-content-get",
        "scope": "pages",
    },
    "page_detail": {
        "method": "GET",
        "path": "/wiki/rest/api/content/{id}",
        "description": "Fetch a single page with rendered body content.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content/#api-content-id-get",
        "scope": "pages",
    },
    "attachment_list": {
        "method": "GET",
        "path": "/wiki/rest/api/content/{id}/child/attachment",
        "description": "List attachments belonging to a page.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content---attachments/#api-content-id-child-attachment-get",
        "scope": "attachments",
    },
    "user_current": {
        "method": "GET",
        "path": "/wiki/rest/api/user/current",
        "description": "Verify authenticated user metadata.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-user/#api-user-current-get",
        "scope": "users",
    },
    "site_info": {
        "method": "GET",
        "path": "/wiki/rest/api/settings/systemInfo",
        "description": "Fetch Confluence site/system information.",
        "docs": "https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-settings---system/#api-settings-systeminfo-get",
        "scope": "system",
    },
}

CONFLUENCE_DATASET_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "confluence.space": {
        "name": "Confluence Spaces",
        "entity": "spaces",
        "description": "Logical Confluence spaces (wiki areas) with metadata such as status, type, and links.",
        "static_fields": [
            {"name": "spaceKey", "data_type": "STRING", "nullable": False, "comment": "Space key (e.g. ENG)."},
            {"name": "name", "data_type": "STRING", "nullable": False},
            {"name": "type", "data_type": "STRING", "nullable": True},
            {"name": "status", "data_type": "STRING", "nullable": True},
            {"name": "url", "data_type": "STRING", "nullable": True},
            {"name": "description", "data_type": "STRING", "nullable": True},
        ],
        "api_keys": ["space_search", "space_detail"],
        "ingestion": {
            "enabled": True,
            "unit_id": "confluence.space",
            "display_name": "Spaces",
            "description": "Catalog of Confluence spaces scoped by the endpoint configuration.",
            "supports_incremental": False,
            "default_policy": None,
            "cdm_model_id": CDM_DOC_SPACE,
        },
    },
    "confluence.page": {
        "name": "Confluence Pages",
        "entity": "pages",
        "description": "Pages/articles stored within spaces including creator/updater metadata.",
        "static_fields": [
            {"name": "pageId", "data_type": "STRING", "nullable": False},
            {"name": "spaceKey", "data_type": "STRING", "nullable": False},
            {"name": "title", "data_type": "STRING", "nullable": False},
            {"name": "status", "data_type": "STRING", "nullable": True},
            {"name": "createdAt", "data_type": "TIMESTAMP", "nullable": True},
            {"name": "updatedAt", "data_type": "TIMESTAMP", "nullable": True},
            {"name": "author", "data_type": "STRING", "nullable": True},
            {"name": "updatedBy", "data_type": "STRING", "nullable": True},
        ],
        "api_keys": ["page_search", "page_detail"],
        "ingestion": {
            "enabled": True,
            "unit_id": "confluence.page",
            "display_name": "Pages",
            "description": "Confluence pages and blog posts.",
            "supports_incremental": True,
            "default_policy": {"cursor": "updatedAt"},
            "cdm_model_id": CDM_DOC_ITEM,
        },
    },
    "confluence.attachment": {
        "name": "Confluence Attachments",
        "entity": "attachments",
        "description": "Attachments stored on pages (files, media) with MIME types and sizes.",
        "static_fields": [
            {"name": "attachmentId", "data_type": "STRING", "nullable": False},
            {"name": "pageId", "data_type": "STRING", "nullable": False},
            {"name": "title", "data_type": "STRING", "nullable": False},
            {"name": "mediaType", "data_type": "STRING", "nullable": True},
            {"name": "fileSize", "data_type": "LONG", "nullable": True},
            {"name": "downloadLink", "data_type": "STRING", "nullable": True},
            {"name": "createdAt", "data_type": "TIMESTAMP", "nullable": True},
            {"name": "createdBy", "data_type": "STRING", "nullable": True},
        ],
        "api_keys": ["attachment_list"],
        "ingestion": {
            "enabled": True,
            "unit_id": "confluence.attachment",
            "display_name": "Attachments",
            "description": "Files and media attached to Confluence pages.",
            "supports_incremental": True,
            "default_policy": {"cursor": "createdAt"},
            "cdm_model_id": CDM_DOC_LINK,
        },
    },
    "confluence.acl": {
        "name": "Confluence ACL",
        "entity": "acl",
        "description": "Access control mappings from principals (users/groups) to docs.",
        "static_fields": [
            {"name": "principalId", "data_type": "STRING", "nullable": False},
            {"name": "principalType", "data_type": "STRING", "nullable": False},
            {"name": "docCdmId", "data_type": "STRING", "nullable": False},
            {"name": "grantedAt", "data_type": "TIMESTAMP", "nullable": True},
        ],
        "api_keys": [],
        "ingestion": {
            "enabled": True,
            "unit_id": "confluence.acl",
            "display_name": "ACL",
            "description": "ACL edges linking principals to docs (placeholder implementation).",
            "supports_incremental": True,
            "default_policy": {"acl_principals": ["confluence:public"]},
            "cdm_model_id": CDM_DOC_ACCESS,
        },
    },
}

__all__ = ["CONFLUENCE_API_LIBRARY", "CONFLUENCE_DATASET_DEFINITIONS"]
