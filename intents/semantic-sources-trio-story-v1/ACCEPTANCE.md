## `intents/semantic-sources-trio-story-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Capabilities & Emits
   - Type: docs
   - Evidence: A table lists capabilities and declared `emits` domain patterns for Jira, Confluence, OneDrive.

2) CDMs & Identity
   - Type: docs
   - Evidence: Field mapping tables for work.item/user/comment/worklog/attachment/link; doc.page/comment/attachment/space; file.item/folder; canonical ID formulas include scope.

3) Ingestion Contract
   - Type: docs
   - Evidence: `listUnits`, `syncUnit`, `estimateLag` signatures; KV checkpoint key/value schema; rate-limit/backoff behavior; error semantics per source.

4) Signals
   - Type: docs
   - Evidence: Enumerated discovery + enrichment signals per source with examples; idempotency rule using `(endpointId, source_event_id)`; phases (`raw|hypothesis|normalized|enriched`).

5) KB & Vector
   - Type: docs
   - Evidence: Node/edge upsert mapping (with scope/provenance/phase); vector profiles (fields, chunking, namespaces) for work/doc/file.

6) GraphQL Surfaces
   - Type: docs
   - Evidence: Additive query/mutation shapes for unit enumeration, enable/pause, schedule, status; response fields include `enabled`, `lastRun`, `lag`, `checkpoint`, `errors`, `stats`.
```

---

