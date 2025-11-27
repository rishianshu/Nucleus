# SPEC — Ingestion filters & incremental Jira v1

## Problem

Current ingestion has gaps:

- Filters are primitive or non-existent:
  - You cannot say “only projects X/Y, only statuses In Progress/Done, only issues assigned to team Z” in a structured way.
  - Filters are not tied to Jira metadata (projects, users, statuses).
- Incremental behavior is too coarse:
  - No per-dimension cursors (e.g. per project).
  - Changing filters (adding projects/users) is hard to do without full reload.
- Endpoints don’t have a clean way to use KV/transient state to:
  - store pagination cursors,
  - track per-dimension progress,
  - survive retries and partial failures.

We need a contract for:

1. **Ingestion filters** (metadata-driven, per-unit).
2. **Incremental semantics** (per dimension).
3. **Transient state** that endpoints can use, backed by KV.

## Interfaces / Contracts

### 1. Ingestion filters contract

#### 1.1. Config model

Introduce a structured filter object per ingestion unit, stored in config:

```ts
export interface JiraIngestionFilter {
  projectKeys?: string[];        // e.g. ["PROJ", "OPS"]
  statuses?: string[];           // e.g. ["In Progress", "Done"]
  assigneeIds?: string[];        // Jira account IDs
  updatedFrom?: string | null;   // ISO timestamp, default null (all history)
  // future: labels, issueTypes, etc.
}

export interface IngestionUnitConfig {
  unitId: string;
  sourceEndpointId: string;
  sinkEndpointId: string;
  mode: "raw" | "cdm";
  filter?: JiraIngestionFilter;  // NEW for Jira units
  // ... existing fields (schedule, etc.)
}
````

Rules:

* Filters are optional; absence = “no filter” (ingest everything).
* For this slug, filter type may be Jira-specific (namespaced), but the pattern should be extensible to other endpoints later.

#### 1.2. GraphQL

In ingestion GraphQL:

* Add input/output types reflecting `JiraIngestionFilter`.
* For units bound to Jira endpoint:

  * expose `filter` in config queries/mutations.
* Enforce type-level constraint:

  * only Jira-based units may use `JiraIngestionFilter` (others ignore or use a different type later).

#### 1.3. Metadata-driven filter values

The UI should not hardcode lists; instead, filter options are populated from Jira metadata:

* Projects: from Jira metadata dataset (e.g. `jira.projects`).
* Users: from Jira metadata dataset (e.g. `jira.users`).
* Statuses: from Jira metadata dataset (e.g. `jira.statuses` or from issues metadata).

Implementation detail:

* Expose GraphQL endpoints for Jira metadata lookups (if not already) or reuse existing catalog/metadata APIs.
* UI will:

  * fetch projects/users/statuses via these queries,
  * present them as dropdowns/multiselects,
  * store the selected keys/ids as filter config.

### 2. Incremental ingestion semantics

We establish:

* A per-unit, **per-dimension cursor model**, such as:

  * dimension key = project key (`"PROJ"`), or compound key (project+status if needed).
  * value = last `updated_at` processed for that dimension.

#### 2.1. Cursor storage model

Define a generic incremental state structure persisted via KV:

* Key pattern (conceptual):

  ```text
  ingestion:<unit_id>:jira_incremental:<dimension_key>
  ```

* Value (example):

  ```json
  {
    "dimension": "project",
    "key": "PROJ",
    "lastUpdatedAt": "2025-11-16T00:00:00Z"
  }
  ```

For v1, we can:

* use **project key** as the dimension key for issues:

  * Each project has its own `lastUpdatedAt`.
* default `lastUpdatedAt`:

  * If filter.updatedFrom is provided, use that for new dimensions.
  * Otherwise, treat as “from beginning” (Jira’s default behavior).

#### 2.2. Behavior when filters change

We define behavior when filters are modified:

* **Adding a new project to `projectKeys`:**

  * On next run:

    * No cursor exists for that project.
    * Worker (or endpoint) initializes `lastUpdatedAt` to:

      * `filter.updatedFrom` if set, otherwise `null` (from start).
* **Removing a project:**

  * Cursor remains in KV but is not used.
  * Future re-add of that project can either:

    * reuse the existing cursor, OR
    * reset from `updatedFrom` (we decide behavior; v1: reuse existing cursor to avoid reloading).
* **Narrowing statuses/assignees:**

  * Cursors remain unchanged; filters just restrict what issues are fetched.
  * If filters later widen (more statuses), no change to cursors is needed.

This guarantees:

* No forced full reload when adjusting filters.
* New dimensions get a fresh start; existing dimensions continue from their saved cursors.

### 3. Transient state abstraction for endpoints

We introduce a **transient state interface** endpoints can use to manage pagination and incremental state.

#### 3.1. Python interface

In `runtime_common` (conceptually):

```python
from typing import Optional, Dict, Any

class TransientState:
    def get(self, key: str) -> Optional[Dict[str, Any]]:
        ...

    def set(self, key: str, value: Dict[str, Any]) -> None:
        ...

    def delete(self, key: str) -> None:
        ...
```

* Backed by the KV store in the ingestion worker (implementation detail).
* Namespaced by:

  * ingestion unit id,
  * endpoint id,
  * possibly run id (for run-scoped vs persistent state).

For v1:

* Use `unit_id` + dimension key as the main namespace.
* Neighborhood of `TransientState` includes both:

  * pagination cursors (e.g., Jira `startAt` tokens),
  * incremental watermarks (`lastUpdatedAt`).

#### 3.2. Endpoint contract

Extend Jira ingestion endpoint methods to accept `TransientState`:

```python
def ingest_batch(
    self,
    filter: JiraIngestionFilter,
    state: TransientState,
    batch_size: int,
) -> Iterable[Record]:
    ...
```

Behavior:

* On each batch:

  * Read cursor (if any) from `state.get(...)`.
  * Call Jira API with pagination params + filter (project keys, statuses, assignees, updated > lastUpdatedAt).
  * Yield normalized records.
  * Update state:

    * update pagination cursor until “last page”,
    * update `lastUpdatedAt` watermark based on max `updated` seen for each dimension/project.

* On retry:

  * Reuse state to avoid duplication and to continue from the correct point.

Worker responsibilities:

* Construct `TransientState` for the unit (wrapping KV).
* Loop calling `ingest_batch` until no more records (or time limits).
* Commit final state at the end of a run.

### 4. UI behavior for filters

Ingestion config UI for Jira units:

* When unit is bound to Jira:

  * Show a “Filters” panel:

    * Projects → multiselect from Jira metadata.
    * Statuses → multiselect.
    * Assignees → multiselect (users).
    * `updatedFrom` → date/time picker.
* Save filter as `JiraIngestionFilter` in config.
* Show a warning when:

  * Filters are changed; explain that:

    * existing projects/users will continue from where they left off,
    * newly added projects/users will ingest from `updatedFrom` (or beginning).

No need for advanced JQL UI in v1; we can add that later.

## Data & State

* New `filter` field in ingestion unit config for Jira units.
* New KV entries per unit/dimension for incremental state & pagination.
* No DB schema changes beyond ingestion config model (if persisted in DB).

## Constraints

* Existing ingestion configs must continue to work without modification:

  * `filter` absent → “ingest everything” using existing semantics.
* State keys must be designed to avoid collisions and support future multi-source expansion.

## Acceptance Mapping

* AC1 → filter field persisted and wired to UI.
* AC2 → Jira metadata-driven selectors (projects/users/statuses).
* AC3 → per-dimension incremental cursors via KV-backed TransientState.
* AC4 → filter changes behave as described (new dimensions from inception, existing preserved).

## Risks / Open Questions

* R1: Pagination + incremental interplay (e.g., updated issues moving between statuses mid-run); v1 can choose “updatedAt watermark per project” and accept duplicate reads handled by idempotent sinks.
* Q1: Exact namespacing and TTL behavior for KV; v1 can treat state as long-lived until explicit reset.

