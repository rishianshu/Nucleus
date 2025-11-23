## `intents/ingestion-core-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Units discovery
   - Type: contract + e2e
   - Evidence: `ingestionUnits(endpointId)` returns at least an empty array for endpoints lacking ingestion capability; once a driver is registered, returns typed units (unitId, kind, displayName).

2) KV checkpoint idempotency
   - Type: integration
   - Evidence: After a run, checkpoint contains { lastUpdatedAt|cursor|lastId }; re-running without source changes preserves counts and checkpoint (no duplicates).

3) Workflow lifecycle & resilience
   - Type: integration
   - Evidence: Successful run progresses RUNNING→SUCCEEDED; injected 429/5xx triggers backoff; injected hard error marks FAILED with sanitized message.

4) Sink abstraction & default KB sink
   - Type: contract
   - Evidence: Sink registry exists; "kb" sink is default; `begin/writeBatch/commit` called in order (no-op writes acceptable until a driver produces batches).

5) Admin Ingestion page (ADR-compliant)
   - Type: e2e
   - Evidence: Admin sees endpoints/units, can Run/Pause/Reset; actions show local pending + global toasts; table uses *keep-previous-data*, debounced inputs, cursor pagination (no flicker). :contentReference[oaicite:9]{index=9}

6) No regressions to Catalog/KB
   - Type: e2e
   - Evidence: Existing Catalog/KB tests remain green (loading/scroll/filter/preview wired per ADR). :contentReference[oaicite:10]{index=10}
````

---

