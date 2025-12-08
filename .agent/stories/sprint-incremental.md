# Sprint: Incremental Support

## Goal
Implement true incremental data fetching for Jira, Confluence, and OneDrive connectors.

## Acceptance Criteria

### Jira Incremental (JQL Watermarks)
- [ ] JQL filter: `updated >= {watermark}` for issues/comments/worklogs
- [ ] Track max `updated` timestamp during fetch
- [ ] Store/retrieve checkpoint via metadata
- [ ] Set `SupportsIncremental: true` in capabilities + datasets

### OneDrive Incremental (Delta Tokens)
- [ ] Use `/delta` endpoint for change tracking
- [ ] Store `@odata.deltaLink` in checkpoint metadata
- [ ] Handle `@odata.nextLink` pagination
- [ ] Detect deleted items via `deleted` facet

### Confluence Incremental (History-Based)
- [ ] Expand `history.lastUpdated` on page queries
- [ ] Client-side filter: `lastUpdated.when > checkpoint`
- [ ] Track max timestamp during iteration
- [ ] Store/retrieve checkpoint via metadata

### All Connectors
- [ ] `GetCheckpoint()` returns stored watermark
- [ ] `PlanSlices()` uses checkpoint when provided
- [ ] Unit tests for watermark/delta logic

## Codex Review Points
1. Checkpoint format consistency across connectors
2. Error handling for expired delta tokens (OneDrive 410 Gone)
3. Time zone handling for Jira/Confluence timestamps

## Files to Modify
- `internal/connector/jira/jira.go`, `handlers.go`, `catalog.go`
- `internal/connector/confluence/confluence.go`, `handlers.go`, `catalog.go`
- `internal/connector/onedrive/onedrive.go`, `catalog.go`
