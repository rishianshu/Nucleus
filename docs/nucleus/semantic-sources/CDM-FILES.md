# CDM — Files (OneDrive)

Identity: `file.<entity>::<orgId>::<driveId>::<endpointId>::<sourceId>`.

## file.item
| Field | Type | Notes |
| --- | --- | --- |
| id | string | Canonical |
| drive_id | string | |
| parent_id | string? | parent folder |
| path | string | normalized path |
| name | string | |
| size_bytes | int | |
| mime_type | string | |
| created_at | datetime | |
| updated_at | datetime | |
| created_by_id | string | user |
| modified_by_id | string | user |
| web_url | string | |
| hash | string? | sha1/quickXor |
| is_folder | boolean | `false` |
| attributes | json | delta tokens, share info |

## file.folder
| Field | Type | Notes |
| --- | --- | --- |
| id | string | canonical |
| drive_id | string | |
| parent_id | string? | |
| path | string | |
| name | string | |
| web_url | string | |
| is_folder | boolean | always true |

## file.link (optional)
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| source_item_id | string | |
| target_type | enum | doc/work/external |
| target_ref | string | URL or canonical ID |
| extracted_at | datetime | |

