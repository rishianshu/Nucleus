## ingestion-core-v1 Plan

1. **Ingestion core foundations**
   - Define driver + sink TypeScript interfaces in metadata-core/runtime-common.
   - Add driver/sink registries with DI hooks plus placeholder sample driver for tests.
   - Build KB sink implementation (maps NormalizedRecord to graph nodes/edges) + unit tests.

2. **Checkpoint + workflow plumbing**
   - Implement KV checkpoint helper (read/update/reset) reusing existing KV provider.
   - Create Temporal activities + `IngestWorkflow` orchestrating driver.sync → sink.write → checkpoint advance with retries/backoff.
   - Persist run status (RUNNING/SUCCEEDED/FAILED) and expose internal helpers for GraphQL resolvers.

3. **GraphQL contract + Console UI**
   - Extend metadata API schema/resolvers with ingestion units/status/mutations (admin-gated, additive).
   - Build admin ingestion page in metadata UI with ADR data-loading patterns (keep-previous-data, debounced filters, cursor pagination, action toasts).
   - Hook actions to GraphQL mutations + display workflow results/lag.

4. **Testing + verification**
   - Unit/integration tests for checkpoint idempotency, workflow lifecycle (success + injected failure), sink invocation order.
   - E2E Playwright cover ingestion page actions + ensure existing Catalog/KB specs stay green.
