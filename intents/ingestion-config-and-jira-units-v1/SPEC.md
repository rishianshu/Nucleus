## `intents/ingestion-config-and-jira-units-v1/SPEC.md`

````markdown
# SPEC — Ingestion configuration console & Jira units v1

## Problem

We have:

- Jira endpoint + metadata subsystem that emit Jira datasets into the catalog.   
- A unified Source → Staging → Sink ingestion plane with a Temporal workflow and Python worker.   
- An Ingestion console that lists endpoints and can start stubbed runs.

What’s missing is a **metadata-driven ingestion configuration layer**:

- There is no persistent config for “this dataset ingests incrementally every N minutes into sink X using pk Y and cursor Z”.
- Jira units are hard‑coded and only cover a subset of the Jira datasets.
- The console has no place to enable ingestion for the first time or adjust schedule/mode per unit.
- Dataset views have no visibility into whether/where/how they are ingested.

We need a minimal but extensible config model and UI so ingestion can be safely enabled, inspected, and reused by future connectors.

## Interfaces / Contracts

### 1. Data model (Prisma / runtime)

Introduce an **IngestionUnitConfig** model (name illustrative):

- `id: String @id @default(uuid())`
- `endpointId: String` → FK `MetadataEndpoint.id`
- `datasetId: String` → canonical catalog dataset id (from `CatalogSnapshot`) or the KB logical key for `catalog.dataset`.  
- `unitId: String` → usually equal to `datasetId` for Jira; keeps room for multi-unit datasets.
- `enabled: Boolean` (default `false`)
- `mode: String` (enum-like: `"FULL" | "INCREMENTAL" | "SCD1" | "CUSTOM"`)
- `sinkId: String` (default `"kb"` or future default warehouse sink)
- `scheduleKind: String` ( `"MANUAL" | "INTERVAL"` )
- `scheduleIntervalMinutes: Int?` (only when `scheduleKind = "INTERVAL"`)
- `policy: Json?` (e.g. `{ "primaryKeys": ["issue_id"], "cursorField": "updated", "filters": {...} }`)
- `createdAt`, `updatedAt`

Relations:

- `MetadataEndpoint` has `ingestionConfigs` (one‑to‑many).
- Optionally, `IngestionUnitState` references `configId` to link run state to config.

**Invariant:** `(endpointId, unitId)` is unique.

### 2. Jira ingestion units

Extend Jira metadata + endpoint so that:

- `JiraMetadataSubsystem` continues to emit datasets for:
  - `jira.projects`
  - `jira.issues`
  - `jira.users`
  - `jira.comments`
  - `jira.worklogs`
  - plus catalog-only dictionaries (issue types, statuses, priorities, api_surface). 
- The Jira SourceEndpoint implements `SupportsIngestionUnits`:
  - `list_units()` reflects catalog datasets, returning one `EndpointUnitDescriptor` per ingestable dataset (projects, issues, users, comments, worklogs).
  - Each descriptor includes default `mode` and `policy`:
    - issues: `mode="INCREMENTAL"`, `policy.cursorField="updated"`, pk `["id"]`
    - comments/worklogs: cursor field `updated`/`started`, pk `["id"]`
    - projects/users: `mode="FULL"` (dimension refresh)

Ingestion units **must not** be returned for endpoints whose catalog is empty (collection never ran).

### 3. GraphQL API

Extend `apps/metadata-api/src/schema.ts`:

- Types:

  ```graphql
  type IngestionUnitConfig {
    id: ID!
    endpointId: ID!
    datasetId: ID!
    unitId: ID!
    enabled: Boolean!
    mode: String!
    sinkId: String!
    scheduleKind: String!
    scheduleIntervalMinutes: Int
    policy: JSON
    lastStatus: IngestionStatus   # from existing schema
  }

  extend type Dataset {
    ingestionConfig: IngestionUnitConfig
  }
````

* Queries:

  ```graphql
  extend type Query {
    ingestionUnitConfigs(endpointId: ID!): [IngestionUnitConfig!]!
  }
  ```

* Mutations:

  ```graphql
  input IngestionUnitConfigInput {
    endpointId: ID!
    unitId: ID!
    enabled: Boolean
    mode: String
    sinkId: String
    scheduleKind: String
    scheduleIntervalMinutes: Int
    policy: JSON
  }

  extend type Mutation {
    configureIngestionUnit(input: IngestionUnitConfigInput!): IngestionUnitConfig!
    startIngestion(input: StartIngestionInput!): IngestionActionResult! # reuse existing
  }
  ```

Rules:

* `configureIngestionUnit` upserts an `IngestionUnitConfig` row, validates that:

  * `endpointId` refers to a registered endpoint,
  * `unitId` maps to a known ingestion unit for that endpoint (from Python/metadata),
  * the corresponding dataset exists in the catalog.
* When `enabled` flips from `false`→`true` and `scheduleKind != "MANUAL"`, the resolver creates/updates a Temporal schedule targeting `ingestionRunWorkflow(endpointId, unitId)`. When `enabled` becomes `false`, it disables the schedule.

### 4. Workflow wiring

Update `ingestionRunWorkflow` / activities:

* On **manual start** (`startIngestion` mutation), look up `IngestionUnitConfig` and pass its `mode`, `policy`, `sinkId` into the workflow input; still load checkpoint from KV as today.
* On **scheduled execution**, Temporal schedules the same workflow with the same input.
* TS activities must not re‑implement slice planning; they pass policy through to Python and/or the endpoint’s incremental planner.

Python worker:

* `runIngestionUnit` receives `mode`, `policy`, `sinkId` and translates:

  * `mode="FULL"` → call full export on SourceEndpoint.
  * `mode="INCREMENTAL"` → call incremental planner based on `policy.cursorField`.
  * `mode="SCD1"` → still incremental, but SinkEndpoint performs SCD1‑style merge using `policy.primaryKeys` (actual merge logic may remain in sink).
* Worker returns checkpoint + stats; TS persists into KV + Prisma (`IngestionUnitState`).

### 5. Ingestion console UX

`apps/metadata-ui/src/ingestion/IngestionConsole.tsx`:

* Left: endpoint list (as today, searchable).

* Right: **Units table** for selected endpoint:

  Columns:

  * Dataset name (from catalog: `schema.table` or Jira dataset id)
  * Mode
  * Schedule (“Manual only” / “Every 15m”)
  * Sink
  * Last run status + time
  * Enabled toggle
  * “Run now” action

* Clicking **Configure** (row or icon) opens a drawer:

  * Mode selector (restricted to supported modes per unit).
  * Schedule selector:

    * Manual only
    * Every N minutes (predefined values: 5/15/60 for v1).
  * Sink selector (for now: `"kb"` plus any additional sinks registered).
  * Policy – advanced section, showing PK and cursor fields when applicable (prefilled from defaults, editable for JDBC in the future).

* Actions follow ADR-UI-Actions-and-States:

  * Local loading state on toggle/save/run.
  * Global toast on success/error.
  * Errors from GraphQL are surfaced as banners with sanitized messages.

### 6. Catalog & metadata integration

When an `IngestionUnitConfig` is created or updated:

* GraphQL must expose it via `dataset(id)` → `ingestionConfig`.
* Optionally, emit a KB node:

  ```json
  {
    "entityType": "ingestion.unit",
    "logicalId": "ingestion::<endpointId>::<unitId>",
    "scope": "...",
    "payload": { "mode": "...", "scheduleKind": "...", ... },
    "edges": [{ "type": "CONFIGURES", "target": "<datasetLogicalKey>" }]
  }
  ```

so that the KB Admin Console can show which datasets are being ingested.

## Data & State

* **Source of truth** for ingestion configuration is `IngestionUnitConfig` in Prisma.
* **Operational state** (checkpoints, last run stats) remains in KV + `IngestionUnitState`.
* **Metadata linkage** is via `datasetId` and/or KB logical keys; catalog datasets and ingestion units must stay in sync.
* Disabling an endpoint (or deleting it) should cascade to configs and schedules (cleanup handled in existing endpoint‑lifecycle behavior).

## Constraints

* No breaking GraphQL changes; new fields and operations only.
* Keep Temporal scheduling simple: one schedule per `(endpointId, unitId)` using basic interval semantics.
* Do not treat KB as a data sink; ingestion policies may enrich KB, but staged/landed rows remain in sinks.

## Acceptance Mapping

* AC1 → Data model + Jira units derived from catalog (unit tests + integration tests against Jira stub).
* AC2 → GraphQL upsert + read of `IngestionUnitConfig` bound to catalog datasets.
* AC3 → Manual “Run now” uses config and produces a run visible in the console.
* AC4 → Interval schedules trigger repeated runs without manual actions (Temporal schedule tests).
* AC5 → Dataset detail query exposes ingestion config and last run info.

## Risks / Open Questions

* R1: Temporal scheduling API in the dev stack may need additional plumbing for per-unit schedules.
* R2: Allowing arbitrary policy JSON could lead to inconsistent configs; we should document minimal keys per endpoint.
* Q1: For JDBC, how much SCD1 configuration do we surface in v1 vs a later slug focused on warehouse sinks?

````

---

