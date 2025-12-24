# Log: Checkpoint Tightening and Store Hardening

## 2025-12-23

### Phase 3: Checkpoint History
- **[IMPL]** Created `checkpoint_history.go` with `ArchiveCheckpoint()` and `GetCheckpointHistory()` functions.
- **[DESIGN]** Uses log-store (`GatewayStore`) for MinIO-backed checkpoint snapshots.
- **[BUILD]** All tests pass, build succeeded.

### Phase 2: Staging Provider Validation
- **[IMPL]** Added logging when defaulting to MinIO.
- **[IMPL]** Added error if explicit provider not found.

### Phase 1: Endpoint Checkpoint Fixes
- **[FIX:GitHub]** Added `since=` parameter for incremental API calls.
- **[FIX:GitHub]** Added `Checkpoint()` method to `recordIterator`.
- **[FIX:Jira]** Wired `req.Checkpoint` to `Slice.Lower` for JQL filtering.
- **[FIX:Jira]** Added `Checkpoint()` method to `issueIterator`.
- **[FIX:Confluence]** Pass checkpoint to `Read` in `ReadSlice`.
- **[FIX:TS]** Fixed TypeScript checkpoint wrapping bug in `activities.ts`.
- **[FIX:Go]** Added recursive `flattenCursor()` to handle legacy nesting (34 levels).

### Root Cause Analysis
- **[ANALYSIS]** Checkpoint nesting: TypeScript was wrapping entire checkpoint in `cursor` field.
- **[ANALYSIS]** Incremental failing: GitHub connector ignored `req.Checkpoint` entirely.
