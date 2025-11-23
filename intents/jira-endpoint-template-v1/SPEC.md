## `intents/ingestion-core-v1/SPEC.md`

````markdown
# SPEC — Ingestion Core v1 (generic)

## Problem
We need one ingestion substrate for all sources. Semantic-aware adapters (e.g., Jira with CDM) should fit the same contracts as raw adapters. Sinks must be pluggable so we can write to the KB now and to other destinations later, without redesign.

## Interfaces / Contracts

### A) Endpoint capabilities (inform routing)
- Sources declare any of: `ingest.pull` (poll), `ingest.push` (webhook), `ingest.stream` (event stream).
- Semantic-aware sources may also declare `semantic:<domain>` (e.g., `semantic:work`) to advertise built-in CDM mapping. Nothing else changes in the core.

### B) Driver interface (vendor-agnostic)
```ts
interface IngestionDriver {
  listUnits(endpointId: string): Promise<Array<{unitId:string, kind:string, displayName:string, stats?:any}>>;
  estimateLag(endpointId: string, unitId: string): Promise<number>; // milliseconds
  syncUnit(args: {
    endpointId: string, unitId: string, checkpoint?: any, limit?: number
  }): Promise<{
    newCheckpoint: any,
    stats: { scanned:number, upserts:number, edges:number, durationMs:number },
    batches: Array<NormalizedBatch>, // may be [] if nothing to do
    sourceEventIds: string[],        // for idempotency at sink
    errors: Array<{ code:string, message:string, sample?:any }>
  }>;
}
type NormalizedBatch = {
  records: Array<NormalizedRecord>;
};
type NormalizedRecord = {
  entityType: string,      // CDM or raw type, e.g. "work.item" or "raw.http"
  logicalId?: string,      // optional; sink can build scoped key if not provided
  scope: { orgId:string, domainId?:string, projectId?:string, teamId?:string },
  provenance: { endpointId:string, vendor:string, sourceEventId?:string },
  payload: any,            // normalized or raw vendor payload
  edges?: Array<{ type:string, src:string, dst:string, props?:any }>
  phase?: "raw"|"normalized"|"enriched"
};
````

### C) KV checkpoints (per endpoint+unit)

* Key: `ingest::<vendor>::<endpointId>::unit::<unitId>`
* Value: `{ lastUpdatedAt?: string, cursor?: any, lastId?: string, lastRunId?: string, stats?: any }`
* Idempotent; safe to re-run without duplicates.

### D) Temporal workflow (short-lived per run)

* `IngestWorkflow(endpointId, unitId, sinkId='kb', since?)`
* Activities: `loadCheckpoint` → `driver.syncUnit` (internal paging) → `writeToSink(batch)` → `advanceCheckpoint`.
* Timeouts: activity=30s; run cap ≤30m (configurable). Retries: exponential backoff.
* Never long-running; schedules (future) will trigger new runs.

### E) Sinks (pluggable)

```ts
interface IngestionSink {
  begin(ctx: { endpointId:string, unitId:string, runId:string }): Promise<void>;
  writeBatch(batch: NormalizedBatch): Promise<{ upserts:number, edges:number }>;
  commit(stats:any): Promise<void>;
  abort(err:any): Promise<void>;
}
```

* **KB sink (default)**: builds scoped `logicalKey` per record (if not provided), upserts nodes/edges idempotently, stores provenance and phase.
* Future sinks:

  * **JDBC sink** (write CDM tables) via a *sink Endpoint* (capability `sink.jdbc`).
  * **Object sink** (blob storage) via `sink.object`.
* Core doesn’t care which sink is chosen; the **GraphQL input** allows `sinkId` (default "kb").

### F) GraphQL (additive; admin-only)

```graphql
type IngestionUnit { unitId: ID!, kind: String!, displayName: String! }
type IngestionStatus {
  endpointId: ID!, unitId: String!, state: String!,
  lastRunId: String, lastRunAt: DateTime, lastError: String, stats: JSON, checkpoint: JSON
}
type Query {
  ingestionUnits(endpointId: ID!): [IngestionUnit!]!
  ingestionStatus(endpointId: ID!, unitId: String!): IngestionStatus!
  ingestionStatuses(endpointId: ID!): [IngestionStatus!]!
}
type Mutation {
  startIngestion(endpointId: ID!, unitId: ID!, sinkId: String, since: DateTime, dryRun: Boolean): Boolean!
  pauseIngestion(endpointId: ID!, unitId: ID!): Boolean!
  resetCheckpoint(endpointId: ID!, unitId: ID!, toTimestamp: DateTime): Boolean!
}
```

### G) Console (admin): Ingestion page

* Table columns: Endpoint, Vendor, Unit, Lag, Last run (status, counts, duration), Actions (Run once, Pause/Resume, Reset).
* Follow **ADR-UI** + **ADR-Data-Loading**: debounced inputs, *keep-previous-data*, cursor pagination, action toasts; no flicker. 

## Data & State

* KV checkpoint per endpoint+unit.
* Status per run (state, error, stats, runId, timestamps).
* Sinks record provenance and scope (no cross-tenant leakage).

## Constraints

* Additive GraphQL only; p95 < 200ms for status reads.
* Short-lived runs; retry/backoff for 429/5xx; sanitized errors.
* UI adheres to ADR patterns shared with Catalog/KB.

## Acceptance Mapping

* AC1 → GraphQL surfaces exist & role-gated (admin).
* AC2 → KV checkpoint creates/updates idempotently.
* AC3 → Workflow lifecycle (RUNNING→SUCCEEDED/FAILED with retries/backoff).
* AC4 → Sink interface present; KB sink registered as default.
* AC5 → Admin UI actions & data-loading match ADR (debounce, *keep-previous-data*, cursor pagination). 
* AC6 → Catalog/KB flows still green (no regressions). 

## Risks / Open Questions

* Parallelism per endpoint (keep serial by default in v1).
* Large units need per-run caps (items/duration); include defaults in workflow config.

````

---

