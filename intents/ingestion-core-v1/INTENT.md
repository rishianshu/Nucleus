- title: Ingestion Core v1 (generic drivers, units, KV checkpoints, sinks, GraphQL, UI)
- slug: ingestion-core-v1
- type: feature
- context:
  - apps/metadata-api (GraphQL: ingestion units/control/status)
  - workers (Temporal workflows/activities)
  - Semantic KV (per endpoint+unit checkpoints)
  - GraphStore (default sink) + pluggable sink interface
  - apps/metadata-console (admin “Ingestion” page)
- why_now: We will ingest Jira first, but the platform needs a reusable ingestion base so all sources—semantic-aware or not—plug in uniformly. This avoids Jira-specific logic bleeding into the platform and enables future sinks (JDBC/Object) without redesign.
- scope_in:
  - **Driver interface** (vendor-agnostic): `listUnits`, `syncUnit(fromCheckpoint)`, `estimateLag`, `rateLimitInfo?`.
  - **Units**: per endpoint (e.g., Jira=projectKey; Confluence=space; OneDrive=drive/folder).
  - **KV checkpoints**: per (endpointId, unitId, domain) — idempotent, re-runnable.
  - **Temporal workflow**: short-lived per-run; retries/backoff/timeouts.
  - **Sink abstraction**: registerable sinks; default **KB sink**; optional `sinkId` arg (defaults to "kb").
  - **GraphQL (additive)**: `ingestionUnits`, `startIngestion`, `pauseIngestion`, `resetCheckpoint`, `ingestionStatus(es)`.
  - **Console (admin)**: Ingestion page table (Endpoint, Unit, Last run, Actions) following ADR UI/Data-Loading patterns.
- scope_out:
  - Vendor drivers (Jira/Confluence/OneDrive); schedules/cron; vector indexing; HITL.
- acceptance:
  1. GraphQL exposes **units, start/pause/reset, status** (admin-only), additive only.
  2. **KV** writes/readbacks per endpoint+unit are idempotent.
  3. **Temporal run** goes RUNNING→SUCCEEDED (happy) and marks FAILED with sanitized message on error; retries/backoff used.
  4. **Sink interface** exists; **KB sink** registered as default (no-op until a driver writes batches).
  5. **Ingestion** page lists units and actions; actions show local pending + global toasts; list uses debounced inputs, cursor pagination, *keep-previous-data* (no flicker).
  6. No regressions to Catalog/KB screens (ADR patterns remain green). :contentReference[oaicite:1]{index=1}
- constraints:
  - Additive GraphQL only; scope-filtered reads by default.
  - UI must honor ADR-UI and ADR-Data-Loading (debounce, *keep-previous-data*, cursor pagination). 
- non_negotiables:
  - Short-lived runs; schedules only *trigger* runs.
  - Scoped logical identity and provenance flow through sinks; secrets redacted.
- refs:
  - catalog-view-and-ux-v1 SPEC (ADR patterns baseline) :contentReference[oaicite:3]{index=3}
  - catalog-view-bugfixes-v0-1 (searchable combos & action feedback patterns) 
- status: in-progress