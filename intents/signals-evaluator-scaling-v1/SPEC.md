# SPEC — Signals evaluator scaling v1

## Problem

The current signals evaluator is functionally correct for small datasets but has hidden scaling and correctness risks:

- It loads **all work items** and **all doc items** into memory via `fetchAllWorkItems` / `fetchAllDocItems` before evaluating conditions.
- It reconciles SignalInstances using a single `listInstances` call with `limit = MAX_PAGE_SIZE` (200), which means:
  - Only the first page of instances is considered for updates/resolution.
  - OPEN instances beyond that limit may never be updated or resolved.
- An exception in one definition's evaluation aborts the entire `evaluateAll` call.
- Unknown or unsupported DSL `spec.type` values can become silent no-ops.

Signals are slow-path and do not need immediate reaction, but they must be **correct** and **scalable** across growing CDM tables and instance counts. We need a paged, resilient design that keeps memory bounded and ensures all relevant instances are reconciled.

## Interfaces / Contracts

### 1. EvaluateSignalsOptions and summary (unchanged externally)

We keep the public evaluator interface stable:

```ts
export type EvaluateSignalsOptions = {
  now?: Date;
  definitionSlugs?: string[];
  dryRun?: boolean;
  sourceRunId?: string | null;
};

export type SignalEvaluationSummary = {
  evaluatedDefinitions: string[];
  skippedDefinitions: { slug: string; reason: string }[];
  instancesCreated: number;
  instancesUpdated: number;
  instancesResolved: number;
};
```

Callers should not see any API change; only behavior improvements.

### 2. Paged CDM access

Instead of `fetchAllWorkItems` / `fetchAllDocItems` building full arrays, the evaluator will operate page-by-page:

```ts
type WorkPage = { rows: CdmWorkItemRow[]; hasNextPage: boolean; cursorOffset?: number | null };
type DocPage = { rows: CdmDocItemRow[]; hasNextPage: boolean; cursorOffset?: number | null };

// Pseudocode shape
async function *iterateWorkItems(filter?: { statusIn?: string[] | null }): AsyncGenerator<CdmWorkItemRow[]> {
  let after: string | null = null;
  while (true) {
    const page = await workStore.listWorkItems({ projectId: null, filter, first: MAX_PAGE_SIZE, after });
    if (page.rows.length > 0) yield page.rows;
    if (!page.hasNextPage) break;
    after = encodeWorkCursor((page.cursorOffset ?? 0) + page.rows.length);
  }
}

async function *iterateDocItems(): AsyncGenerator<CdmDocItemRow[]> {
  let after: string | null = null;
  while (true) {
    const page = await docStore.listDocItems({ projectId: null, filter: {}, first: MAX_PAGE_SIZE, after, secured: false });
    if (page.rows.length > 0) yield page.rows;
    if (!page.hasNextPage) break;
    after = encodeDocCursor((page.cursorOffset ?? 0) + page.rows.length); // or use docStore cursor if available
  }
}
```

The evaluator loops over pages:
- For each page, build a `EvaluatedInstance[]` for rows in that page.
- Apply them immediately (page-level reconciliation) without materializing the entire table.

This keeps memory bounded while allowing full-table scans over time.

### 3. Instance reconciliation without a fixed cap

We remove the assumption that at most 200 instances per definition need reconciliation.

Two acceptable strategies:

**Strategy A: instance paging (minimal change)**

Extend SignalStore with an optional paged listing:

```ts
interface SignalInstancePage {
  rows: SignalInstance[];
  hasNextPage: boolean;
  cursor?: string | null;
}

interface SignalStore {
  // existing methods…

  listInstancesPaged?(filters: {
    definitionIds?: string[];
    status?: string[];
    limit?: number;
    after?: string | null;
  }): Promise<SignalInstancePage>;
}
```

Evaluator then:
- Iterates over all OPEN instances for the given definition using `listInstancesPaged`.
- Builds `existingByRef` across pages (potentially large, but not artificially capped).
- For each page of matches:
  - Calls `upsertInstance` to create/update OPEN instances.
  - Tracks which `entityRef`s were touched in this run.
- After processing CDM pages, walks all existing OPEN instances to mark any non-matching ones as RESOLVED.

**Strategy B: run token (preferred if store can support it)**

Use `sourceRunId` as a run token:
- Caller supplies `sourceRunId` (or evaluator generates one).
- For each `upsertInstance` call during a run, evaluator passes this `sourceRunId`.
- At the end of evaluation for a definition, evaluator resolves stale instances using a single DB-level operation in the store layer:

```ts
// conceptual: not necessarily exposed directly
await signalStore.resolveStaleInstances(definition.id, {
  currentRunId: sourceRunId,
  now,
});
```

Implementation detail (e.g. in Prisma/SQL):

```sql
UPDATE signal_instances
SET status = 'RESOLVED',
    resolved_at = $now
WHERE definition_id = $definitionId
  AND status = 'OPEN'
  AND (source_run_id IS NULL OR source_run_id <> $currentRunId);
```

For v1 of this slug it is sufficient to:
- Implement either Strategy A or Strategy B.
- Ensure that all OPEN instances for a definition are eligible to be resolved, not just the first 200.

The SPEC prefers Strategy B but allows Strategy A if it fits the existing store shape better.

### 4. Definition-level error isolation and unknown types

We harden `evaluateAll` so that:
- Parsing or evaluation errors are local to one definition.
- Unknown `spec.type` is explicitly recorded as a skip.

Pseudo-flow:

```ts
for (const definition of definitions) {
  try {
    const parsed = parseSignalDefinitionSpec(definition.definitionSpec);
    if (!parsed.ok) {
      summary.skippedDefinitions.push({ slug: definition.slug, reason: parsed.reason });
      continue;
    }
    const spec = parsed.spec;
    if (!matchesCdmModel(definition, spec)) {
      summary.skippedDefinitions.push({ slug: definition.slug, reason: "cdmModelId mismatch between definition and spec" });
      continue;
    }
    const handler = evaluatorRegistry[spec.type];
    if (!handler) {
      summary.skippedDefinitions.push({ slug: definition.slug, reason: `unsupported spec type ${spec.type}` });
      continue;
    }

    summary.evaluatedDefinitions.push(definition.slug);
    const counts = await handler.evaluateDefinitionPaged(...);
    // accumulate counts
  } catch (error) {
    summary.skippedDefinitions.push({ slug: definition.slug, reason: `error: ${String(error)}` });
    // do not rethrow, continue with next definition
  }
}
```

This ensures:
- One broken definition does not abort the whole run.
- Unsupported types are visible in `skippedDefinitions` with a clear reason.

## Data & State

The underlying SignalDefinition and SignalInstance schemas remain unchanged. We may:
- Add optional indices to support Strategy B efficiently (e.g. on `(definition_id, status, source_run_id)`).
- Add instrumentation/logging to help measure per-definition evaluation cost.

CDM access:
- No schema changes are required.
- Evaluator's access pattern changes from "load everything" to "iterate pages".

SignalStore:
- If using Strategy A, we add an optional `listInstancesPaged` method and implement it for Prisma-backed store.
- If using Strategy B, we may add an internal helper (`resolveStaleInstances`) in the store implementation, but the evaluator sees it as a method on SignalStore.

## Constraints

- No breaking changes to public GraphQL APIs.
- No change to `EvaluateSignalsOptions` or `SignalEvaluationSummary` structure.
- Evaluator remains deterministic and idempotent for a given `now`, CDM snapshot, and definitions.

## Acceptance Mapping

- AC1 → CDM page-by-page processing implemented; evaluator no longer calls `fetchAllWorkItems` / `fetchAllDocItems` that materialize all rows.
- AC2 → Instance reconciliation uses either instance paging or run-token strategy; no 200-instance cap; tests cover OPEN→RESOLVED semantics.
- AC3 → Unknown DSL `spec.type` values are skipped with an explicit reason; `parseSignalDefinitionSpec` plus evaluator registry (or equivalent) enforce this.
- AC4 → Definition-level errors are caught and recorded in `skippedDefinitions` without aborting other definitions; integration tests simulate at least one failing definition.
- AC5 → Docs updated (Signals evaluator section) to describe the paged evaluation and resolution strategy; CI (`pnpm ci-check`) green.

## Risks / Open Questions

- R1: If instance counts become very large and we use Strategy A, building `existingByRef` in memory per definition may still be heavy; Strategy B mitigates this with a DB-level resolution step.
- R2: Using a DB-level UPDATE for resolution requires careful scoping (per definition and status) to avoid touching unintended rows.
- Q1: Should `sourceRunId` be required for all callers of `evaluateAll` or optional? For v1, we can generate a run ID when one is not provided.
- Q2: How will this evaluator be migrated into Temporal workflows later? The new paged structure and per-definition handler are designed to be easy to reuse in workflow activities.
