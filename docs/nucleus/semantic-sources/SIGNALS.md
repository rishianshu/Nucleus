# Signals — Discovery & Enrichment

All signals carry:
- `scope`: { orgId, domainId?, projectId?, teamId? }
- `provenance`: { endpointId, source_event_id, captured_at }
- `phase`: `raw | hypothesis | normalized | enriched`
- `revision`: increments when the same `(endpointId, source_event_id)` replays.

## Jira (Work)
| Signal | Phase | Payload |
| --- | --- | --- |
| `entity.work.item.created` | raw→normalized | work.item snapshot |
| `entity.work.item.updated` | raw→normalized | changed fields + version |
| `entity.work.item.deleted` | raw | tombstone |
| `process.work.lifecycle.transitioned` | enriched | { itemId, fromStatus, toStatus, actorId, occurred_at } |
| `entity.work.comment.created` | raw→normalized | work.comment |
| `entity.work.comment.updated` | raw | comment diff |
| `entity.work.attachment.added` | hypothesis | work.attachment metadata |

## Confluence (Docs)
| Signal | Phase | Payload |
| --- | --- | --- |
| `entity.doc.page.created` | raw→normalized | doc.page |
| `entity.doc.page.updated` | raw→normalized | doc.page delta + new version |
| `entity.doc.page.deleted` | raw | tombstone |
| `entity.doc.comment.created` | raw | doc.comment |
| `entity.doc.comment.updated` | raw | comment delta |
| `entity.doc.attachment.added` | hypothesis | doc.attachment |
| `entity.doc.page.labeled` | enriched | { pageId, label, action } |

## OneDrive (Files)
| Signal | Phase | Payload |
| --- | --- | --- |
| `entity.file.item.created` | raw→normalized | file.item |
| `entity.file.item.updated` | raw→normalized | delta fields |
| `entity.file.item.deleted` | raw | tombstone |
| `entity.file.folder.created` | raw | file.folder |
| `entity.file.folder.updated` | raw | delta |
| `entity.file.link.created` | hypothesis | references extracted from file metadata |

Idempotency: `(endpointId, source_event_id)` must uniquely identify every signal. Drivers derive `source_event_id` from vendor change IDs (Jira changelog ID, Confluence `versionId`, OneDrive delta token). Duplicate delivery increments `revision` while leaving semantic state unchanged.
