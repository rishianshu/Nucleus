# CDM — Docs (Confluence)

Identity: `doc.<entity>::<orgId>::<spaceKey>::<endpointId>::<sourceId>`.

## doc.page
| Field | Type | Notes |
| --- | --- | --- |
| id | string | Canonical |
| space_key | string | Source space |
| title | string | |
| body_html | text | storage format |
| body_text | text | plain-text extraction |
| version | int | increments on edit |
| labels | string[] | |
| author_id | string | `doc.user` (alias of work.user) |
| created_at | datetime | |
| updated_at | datetime | |
| url | string | canonical web link |
| attributes | json | extras |

## doc.comment
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| page_id | string | FK `doc.page` |
| parent_comment_id | string? | threaded |
| author_id | string | |
| body | text | |
| created_at | datetime | |
| updated_at | datetime? | |

## doc.attachment
| Field | Type | Notes |
| --- | --- | --- |
| id | string | |
| page_id | string | |
| filename | string | |
| mime_type | string | |
| size_bytes | int | |
| download_url | string | |

## doc.space
| Field | Type | Notes |
| --- | --- | --- |
| id | string | `doc.space::<orgId>::<endpointId>::<spaceKey>` |
| key | string | space key |
| name | string | |
| url | string | |
| description | text? | optional |

