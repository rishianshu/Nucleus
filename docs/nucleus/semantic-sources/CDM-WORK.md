# CDM — Work (Jira)

All IDs include scope: `work.<entity>::<orgId>::<projectKey>::<endpointId>::<sourceId>`.

## work.item
| Field | Type | Notes |
| --- | --- | --- |
| id | string | Canonical ID (see above) |
| source_issue_key | string | Native Jira issue key |
| project_key | string | Jira project key |
| issue_type | string | Standardized (story/bug/task/epic/other) |
| status | string | Current workflow status |
| priority | string | Normalized (highest→lowest) |
| summary | string | Title |
| description | text | Markdown/plain text body |
| labels | string[] | Plain labels |
| assignee_id | string | `work.user` ID |
| reporter_id | string | `work.user` ID |
| created_at | datetime | Source timestamp |
| updated_at | datetime | Source timestamp |
| resolved_at | datetime? | Optional |
| attributes | json | passthrough custom fields |

## work.user
| Field | Type | Notes |
| --- | --- | --- |
| id | string | `work.user::<orgId>::<endpointId>::<sourceUserId>` |
| source_user_id | string | Vendor user identity |
| display_name | string | |
| email | string? | stored only if allowed by scope |
| active | boolean | |
| time_zone | string? | optional |

## work.comment
| Field | Type | Notes |
| --- | --- | --- |
| id | string | `work.comment::<scope>` |
| work_item_id | string | FK to `work.item` |
| author_id | string | FK to `work.user` |
| body | text | comment body |
| created_at | datetime | |
| updated_at | datetime? | |

## work.worklog
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| work_item_id | string | |
| author_id | string | |
| started_at | datetime | |
| time_spent_seconds | int | |

## work.attachment
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| work_item_id | string | |
| filename | string | |
| mime_type | string | |
| size_bytes | int | |
| download_url | string | signed vendor URL |

## work.link
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| source_type | enum | `issue`, `doc`, `file`, etc. |
| source_id | string | |
| target_type | enum | |
| target_ref | string | URL or canonical ID |
| link_type | string | Jira link type |

