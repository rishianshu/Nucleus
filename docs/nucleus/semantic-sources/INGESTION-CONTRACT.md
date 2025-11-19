# Ingestion Contract — Jira · Confluence · OneDrive

## Driver Interface
```
listUnits(endpointId: ID!): [SemanticUnit!]          // project/space/drive summary
syncUnit(endpointId: ID!, unitId: ID!, fromCheckpoint: Checkpoint?): SyncResult
estimateLag(endpointId: ID!, unitId: ID!): Duration
```

### `SemanticUnit`
- `unitId`: string (projectKey / spaceKey / driveId[:folderId])
- `kind`: enum (`project`, `space`, `drive`, `folder`)
- `displayName`: string
- `stats`: { `items`, `lastUpdatedAt`, `errors?` }

### `SyncResult`
- `newCheckpoint`: Checkpoint
- `stats`: { `processed`, `inserted`, `updated`, `deleted`, `durationMs`, `rateLimit` }
- `source_event_ids`: string[] (for idempotency)
- `errors`: Array<{ code, message, sampleEntity }>

## Checkpoint KV Schema
```
key = semantic::<vendor>::endpoint::<endpointId>::unit::<unitId>::domain::<domain>
val = {
  "cursor": string?,              // vendor delta token or timestamp
  "last_updated_at": ISO datetime,
  "last_run_id": string,
  "stats": { "processed": int, "errors": int }
}
```
- Stored in Semantic KV Store, partitioned by endpointId.
- Updated atomically after successful batch; partial failures keep previous checkpoint but log errors.

## Incremental Rules
| Source | Unit | Cursor Strategy |
| --- | --- | --- |
| Jira | Project | JQL `updated >= last_updated_at ORDER BY updated ASC`; fallback to issue changelog if > 10k results. |
| Confluence | Space | Filter by `version.when >= last_updated_at`; attachments follow same cursor. |
| OneDrive | Drive/Folder | Use Graph delta tokens when available; otherwise `updatedDateTime >= last_updated_at`. |

## Rate-Limit & Backoff
- Drivers expose `rateLimit` stats: `{ limitPerWindow, windowSeconds, remaining, resetAt }`.
- On HTTP 429/503, drivers must exponential backoff (`minDelay=2s`, `maxDelay=2m`, jitter) and log into `stats.backoffMs`.
- Controller may pause units when `remaining/limit < 0.1` (data used by GraphQL status).

## Error Semantics
- `errors[]` carries per-entity samples; ingest UI surfaces counts only.
- Retries must be idempotent. Deduplicate by `(endpointId, source_event_id)` or vendor delta token.
- Fatal auth/config errors set `SyncResult.status = "FAILED"` and preserve checkpoint.

## Source-Specific Notes
- **Jira**: `listUnits` returns projects (key + name). `syncUnit` may batch by issue type; custom fields go into `attributes`. Worklogs fetched lazily if requested.
- **Confluence**: `listUnits` returns spaces. `syncUnit` fetches pages, comments, attachments; HTML stored plus extracted text.
- **OneDrive**: `listUnits` returns drives (optionally child folders). When driver is granted webhook permission, it may emit `ingest.webhook` capability but polling remains required fallback.
