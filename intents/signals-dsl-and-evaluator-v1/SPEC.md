# SPEC — Signals DSL & evaluator v1

## Problem

Signals & EPP foundation v1 gave us strongly-typed SignalDefinition/SignalInstance models and a SignalStore, but there is no standard way to encode "how should this signal be computed?" or a shared engine to do the computation. Today, determining whether a work item is stale or a doc is orphaned requires ad-hoc queries over CDM or KB; there is no reusable component that:

- reads SignalDefinitions,
- interprets a definition-specific spec,
- queries CDM,
- and writes back SignalInstances in an idempotent way.

We need a minimal DSL and evaluator so Nucleus can consistently produce signals from CDM work/docs, forming the basis for Brain API, KB projections, and downstream apps like Workspace.

## Interfaces / Contracts

### 1. Signal DSL (definitionSpec)

We introduce a versioned, JSON-based DSL stored in `SignalDefinition.definitionSpec`.

Common envelope:

```ts
interface SignalDefinitionSpecV1 {
  version: 1;
  type: string; // e.g. "cdm.work.stale_item", "cdm.doc.orphan"
  config: Record<string, any>;
}
```

For v1 we support two concrete `type` values:

1. **Work stale item** — `type = "cdm.work.stale_item"`

   Evaluates staleness of `cdm.work.item` rows based on last activity timestamps.

   ```ts
   interface CdmWorkStaleItemConfig {
     cdmModelId: "cdm.work.item";
     maxAge: {
       unit: "days" | "hours";
       value: number; // e.g. 7 days
     };
     statusInclude?: string[]; // optional allowed statuses (e.g. ["To Do", "In Progress"])
     statusExclude?: string[]; // optional excluded statuses (e.g. ["Done", "Cancelled"])
     projectInclude?: string[]; // optional set of project keys or IDs
     projectExclude?: string[];
     severityMapping?: {
       warnAfter?: { unit: "days" | "hours"; value: number };
       errorAfter?: { unit: "days" | "hours"; value: number };
     };
   }
   ```

   Semantics:

   * Work items whose `last_activity_at` (or equivalent CDM field) is older than `maxAge` and match include/exclude filters are **OPEN** signal instances.
   * Severity:

     * If `errorAfter` is configured and age ≥ errorAfter → `ERROR`.
     * Else if `warnAfter` is configured and age ≥ warnAfter → `WARNING`.
     * Else use definition-level default severity.
   * Summary: short text like `"Work item ABC-123 stale for 10 days"`.
   * EntityRef: consistent `cdm.work.item:<cdm_id>` format.

2. **Doc orphan** — `type = "cdm.doc.orphan"`

   Evaluates whether docs (`cdm.doc.item`) are unlinked or underused.

   ```ts
   interface CdmDocOrphanConfig {
     cdmModelId: "cdm.doc.item";
     minAge: {
       unit: "days" | "hours";
       value: number; // e.g. 7 days since creation
     };
     minViewCount?: number; // optional minimum views; below means "orphan-ish"
     requireProjectLink?: boolean; // if true, only flag docs missing a project/work link
     spaceInclude?: string[]; // Confluence spaces, sites, etc.
     spaceExclude?: string[];
   }
   ```

   Semantics:

   * Docs older than `minAge`, with view/event counts below `minViewCount` (if set), and missing required links (if `requireProjectLink = true`), are **OPEN** orphan signals.
   * EntityRef: `cdm.doc.item:<cdm_id>`.
   * Summary: e.g. `"Doc 'Design XYZ' appears orphaned (no project link, low activity)"`.

Unrecognized `type` values:

* Evaluator logs a warning and **skips** (no instances written).
* No partial writes allowed for unknown types.

### 2. Evaluator service

A TypeScript module encapsulates evaluation:

```ts
interface SignalEvaluator {
  evaluateAll(options?: {
    now?: Date;
    definitionSlugs?: string[]; // if provided, restrict to these slugs
    dryRun?: boolean;
  }): Promise<EvaluationSummary>;
}

interface EvaluationSummary {
  evaluatedDefinitions: string[];         // slugs
  skippedDefinitions: { slug: string; reason: string }[];
  instancesCreated: number;
  instancesUpdated: number;
  instancesResolved: number;
}
```

Responsibilities:

* Fetch all ACTIVE SignalDefinitions (or subset by slug).
* Parse `definitionSpec` as `SignalDefinitionSpecV1`.
* For each supported `type`, dispatch to a type-specific evaluation function:

  * `evaluateCdmWorkStaleItems(def: SignalDefinition, spec: CdmWorkStaleItemConfig, now: Date)`
  * `evaluateCdmDocOrphans(def: SignalDefinition, spec: CdmDocOrphanConfig, now: Date)`
* Execute queries against CDM tables to derive entity sets and compute `age` / `viewCount` / linkage.
* Upsert instances via `SignalStore.upsertInstance`, using `(definitionId, entityRef)` as the logical key.
* Optionally mark instances RESOLVED if an entity no longer matches the condition (out of scope for complex rules; for v1 we can leave resolution explicit or document the strategy).

Evaluator must be:

* **Deterministic** for a given `now`, CDM snapshot, and definitions.
* **Idempotent**: running it twice with no CDM changes should not create duplicate instances.

### 3. GraphQL / CLI entrypoint

GraphQL mutation:

```graphql
type SignalEvaluationSummary {
  evaluatedDefinitions: [String!]!
  skippedDefinitions: [SignalSkippedDefinition!]!
  instancesCreated: Int!
  instancesUpdated: Int!
  instancesResolved: Int!
}

type SignalSkippedDefinition {
  slug: String!
  reason: String!
}

extend type Mutation {
  evaluateSignals(
    definitionSlugs: [String!]
    dryRun: Boolean
  ): SignalEvaluationSummary!
}
```

* Restricted to admin roles or an internal service account.
* Calls the `SignalEvaluator.evaluateAll` implementation.
* If `dryRun = true`, no instances are written; only counts of would-be instances are returned (can be approximated for v1 or implemented fully).

Optionally, a small CLI/tsx script:

```bash
pnpm --filter @apps/metadata-api exec tsx src/signals/evaluateSignals.cli.ts --defs work.stale,doc.orphan
```

to run evaluations in dev/CI.

## Data & State

* SignalDefinition / SignalInstance schemas from foundation are reused unchanged.
* Evaluator reads CDM tables:

  * `cdm_work_item` (or equivalent view),
  * `cdm_doc_item`,
  * plus any auxiliary tables needed for views/links (e.g., `cdm_doc_link`).
* Evaluator does **not** modify CDM or KB in this slug; only SignalStore contents.

**Idempotency:**

* For each definition + entityRef combination:

  * If an OPEN instance exists and the entity still matches:

    * Update `lastSeenAt`, `summary`, `details`, `severity` if needed.
  * If no instance exists and the entity matches:

    * Create a new instance (`firstSeenAt = lastSeenAt = now`).
  * If an OPEN instance exists but the entity no longer matches:

    * Strategy for v1: either:

      * Leave as OPEN (documented limitation), or
      * Mark as RESOLVED when we are confident (recommended).
* Exact resolution policy should be encoded in the evaluator and documented.

## Constraints

* DSL v1 is limited to a small set of `type`s and fields; we favour clarity and testability over power.
* Evaluator must fail closed for unknown `type`s or malformed specs (log + skip).
* GraphQL and CLI entrypoints must not expose raw CDM internals (no arbitrary SQL or filters).
* No changes to ingestion pipeline; evaluator only reads from CDM tables.

## Acceptance Mapping

* AC1 → DSL schema is documented and encoded in `definitionSpec` for at least two SignalDefinitions (work + docs).
* AC2 → Evaluator implementation in TS loads definitions, dispatches on `type`, queries CDM, and uses SignalStore to upsert instances idempotently.
* AC3 → GraphQL mutation `evaluateSignals` exists, is wired to the evaluator, and returns a summary.
* AC4 → Tests seed CDM data and verify that running the evaluation produces expected SignalInstances for the work-stale and doc-orphan signals.
* AC5 → Docs updated with a Signals DSL v1 section showing how to author new definitions and explaining evaluator behaviour.

## Risks / Open Questions

* R1: Hardcoding per-type evaluators may lead to proliferation if we add many signals; we mitigate this by constraining v1 to only two types and documenting the expected shape for future ones.
* R2: Resolution semantics (when to mark instances RESOLVED) can be tricky; for v1 we can adopt a simple rule (e.g. "if entity no longer matches, mark RESOLVED") and note potential edge cases.
* Q1: Should evaluation always run across all tenants/workspaces, or accept an optional scope (workspace/project)? For v1, we can keep it global and document that scoping will be added later.
* Q2: How heavy can the CDM queries be? v1 will target modest data volumes; future slugs may need pagination and incremental strategies.
