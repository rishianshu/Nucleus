# SPEC — Signals extensibility & packs v1

## Problem

We have:

- SignalDefinition/SignalInstance models and SignalStore.
- A versioned DSL with at least two concrete types (`cdm.work.stale_item`, `cdm.doc.orphan`).
- A scalable evaluator that pages through CDM and reconciles instances.

But:

- Adding new signals still requires **changing evaluator code** for each new `spec.type`.
- There is no structured way to group and ship **signal packs per source** (Jira, Confluence, Docs).
- Signal metadata is not rich enough to easily facet by entity/process/policy or source family.

We want to:

- Make most signals **DSL-only**, so adding one is a data/config operation.
- Keep a small, explicit catalog of **code-backed types** for advanced cases.
- Seed **curated packs** of signals per semantic source that can be enabled without code changes.

## Interfaces / Contracts

### 1. SignalDefinition: implementation mode & metadata

We extend the normalized representation of `SignalDefinition` (DB + TS type) with:

```ts
type SignalImplMode = "DSL" | "CODE";

interface SignalDefinition {
  // existing fields…
  implMode: SignalImplMode;       // default "DSL" for new definitions
  sourceFamily?: string | null;   // e.g. "jira", "confluence", "onedrive", "jdbc", "generic"
  entityKind?: string | null;     // e.g. "WORK_ITEM", "DOC", "DATASET", "USER", etc.
  processKind?: string | null;    // e.g. "DELIVERY_FLOW", "REVIEW", "ACCESS_CONTROL", etc.
  policyKind?: string | null;     // e.g. "FRESHNESS", "COMPLETENESS", "OWNERSHIP", "ACCESS", etc.
  surfaceHints?: Record<string, unknown> | null; // optional JSON hints for UI (recommendedViews, category, etc.)
}
```

DB migration:
- Add nullable columns for `impl_mode`, `source_family`, `entity_kind`, `process_kind`, `policy_kind`, `surface_hints` (JSONB).
- Default `impl_mode = 'DSL'` for existing rows; known code-only definitions can later be updated to `'CODE'` if needed.

Semantics:
- **implMode**:
  - `"DSL"`: definition is interpreted through a generic or type-specific DSL handler.
  - `"CODE"`: definition requires a code-backed evaluator registered for its `spec.type`.
- **sourceFamily**:
  - High-level source/system family, aligned with CDM and connector naming.
- **entityKind / processKind / policyKind**:
  - Optional EPP-style classification to support faceting and grouping in UIs and Brain APIs.
- **surfaceHints**:
  - Free-form JSON hints such as `{ "recommendedViews": ["workbench", "projectOverview"], "category": "health" }`.

### 2. Evaluator registry

We route signal evaluation via a registry keyed by `spec.type`:

```ts
type EvaluatedInstance = {
  entityRef: string;
  entityKind: string;
  severity: SignalSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
};

interface EvaluatorContext {
  signalStore: SignalStore;
  workStore: CdmWorkStore;
  docStore: CdmDocStore;
  now: Date;
  options?: EvaluateSignalsOptions;
}

type SignalTypeEvaluator = (
  definition: SignalDefinition,
  spec: ParsedSignalDefinitionSpec,
  ctx: EvaluatorContext,
) => Promise<EvaluationCounts>;

const evaluatorRegistry: Record<string, SignalTypeEvaluator> = {
  "cdm.work.stale_item": evaluateWorkStale,
  "cdm.doc.orphan": evaluateDocOrphan,
  "cdm.generic.filter": evaluateCdmGenericFilter, // new DSL type
  // future types here…
};
```

Core evaluator flow:
- `parseSignalDefinitionSpec` validates the DSL envelope and returns `ParsedSignalDefinitionSpec` with type and config.
- `DefaultSignalEvaluator.evaluateDefinition` becomes:

```ts
const handler = evaluatorRegistry[spec.type];
if (!handler) {
  summary.skippedDefinitions.push({ slug: definition.slug, reason: `unsupported spec type: ${spec.type}` });
  return { created: 0, updated: 0, resolved: 0 };
}
return handler(definition, spec, ctx);
```

Rules:
- For `implMode = "CODE"`, we require a handler to exist in the registry for that `spec.type`; otherwise the definition is skipped.
- For `implMode = "DSL"`, we expect the handler to be DSL-based (generic or type-specific), but from the evaluator's point of view, both are `SignalTypeEvaluator`s.

### 3. Generic DSL type: `cdm.generic.filter`

We add a generic DSL type that can express simple threshold/filter signals for any CDM model.

Example config shape:

```ts
interface CdmGenericFilterConfig {
  cdmModelId: string; // e.g. "cdm.work.item", "cdm.doc.item", "cdm.dataset"
  // Basic filter on CDM fields. Combined with AND semantics.
  where: Array<{
    field: string; // dot paths allowed if needed (e.g. "properties.viewCount")
    op: "LT" | "LTE" | "GT" | "GTE" | "EQ" | "NEQ" | "IN" | "NOT_IN" | "IS_NULL" | "IS_NOT_NULL";
    value?: unknown; // omitted for IS_NULL / IS_NOT_NULL
  }>;
  // Optional severity rules, applied in order
  severityRules?: Array<{
    when: Array<{ field: string; op: string; value?: unknown }>;
    severity: SignalSeverity;
  }>;
  // Summary template supporting simple interpolation from the CDM row
  summaryTemplate: string; // e.g. "Work item {{source_issue_key}} missing owner"
}
```

Notes:
- v1 can restrict field set and operations to a safe subset (e.g. primitive fields and simple relational operators).
- Implementation can use either:
  - evaluation in TS on rows already fetched from CDM (no dynamic SQL), or
  - on top of a lightweight query builder abstraction, but must remain safe and bounded.

Evaluator for `cdm.generic.filter`:
- Determines which CDM store to use based on `cdmModelId`:
  - `"cdm.work.item"` → `CdmWorkStore`.
  - `"cdm.doc.item"` → `CdmDocStore`.
- Uses the existing paged evaluation pattern from `signals-evaluator-scaling-v1`:
  - For each page of rows:
    - Apply `where` conditions in TS.
    - For matches:
      - Compute severity from `severityRules` or fallback to `definition.severity`.
      - Render `summaryTemplate` using the row fields (basic `{{field}}` interpolation).
      - Send matches to the existing reconciliation logic (`applyMatches` or equivalent).
- Unknown fields or unsupported ops should cause the definition to be skipped, with a readable reason.

### 4. Signal packs

We define signal packs as:
- A curated set of SignalDefinition rows, grouped logically by source family and EPP.

For v1 we seed packs as migration/seed data, with all definitions initially `DISABLED` or `status = "DRAFT"`.

Examples:

**Jira Work Pack** (`sourceFamily="jira"`, `entityKind="WORK_ITEM"`):
- `jira.work.stale_item.default`
  - type: `cdm.work.stale_item`
  - config: stale after N days, excluding Done/Cancelled.
  - policyKind: `"FRESHNESS"`.
- `jira.work.unassigned_blocker`
  - type: `cdm.generic.filter` on `cdm.work.item`
  - where: priority = "Blocker", assignee IS NULL, status NOT IN ("Done", "Cancelled").
  - policyKind: `"OWNERSHIP"` / `"RISK"`.
- `jira.work.too_many_reopens`
  - type: `cdm.generic.filter` using a numeric `reopen_count` field, if present.

**Confluence Docs Pack** (`sourceFamily="confluence"`, `entityKind="DOC"`):
- `confluence.doc.orphan`
  - type: `cdm.doc.orphan` (existing type).
  - policyKind: `"COMPLETENESS"`.
- `confluence.doc.stale_low_views`
  - type: `cdm.generic.filter`
  - where: ageDays > N, viewCount < M
  - policyKind: `"FRESHNESS"`.

**OneDrive Docs Pack** (`sourceFamily="onedrive"`, `entityKind="DOC"`):
- `onedrive.doc.orphan`
  - type: `cdm.generic.filter` with conditions on `last_accessed_at`, owner, etc.

Storage:
- Seeds can be implemented as:
  - SQL migrations inserting into `signal_definitions`, or
  - TS/seed scripts run in dev/CI to create the definitions.
- Each seeded definition must have:
  - unique slug,
  - `implMode` set (`"DSL"` for these packs),
  - `sourceFamily`, `entityKind`, `policyKind` etc. set appropriately.

Enablement:
- Pack enablement in v1 can be manual:
  - Admin sets status from `DISABLED`/`DRAFT` → `ACTIVE` for chosen slugs.
- Future slugs can add a "pack" abstraction; for now, grouping is by naming convention and metadata.

## Data & State

- `signal_definitions` table gains new nullable columns for impl mode and metadata.
- Seeded rows are added for the packs.
- No change to `signal_instances` schema.

## Constraints

- Existing definitions must continue to work:
  - For rows without `impl_mode`, migration must default to `"DSL"`.
  - For legacy types, evaluator registry must include handlers (as today).
- `cdm.generic.filter` must not allow arbitrary unsafe evaluation (e.g., no raw SQL injection).

## Acceptance Mapping

- AC1 → New columns and TS fields exist on SignalDefinition for impl mode + metadata.
- AC2 → Evaluator uses a registry keyed by `spec.type`, with explicit handling of missing/unsupported types.
- AC3 → `cdm.generic.filter` is implemented and used for at least some seeded signals.
- AC4 → Seeded signal packs exist for Jira Work and Confluence Docs (and optionally OneDrive) and are expressed via DSL; tests or fixtures verify they can be evaluated.
- AC5 → Docs describe how to use the DSL, when to use `implMode = "CODE"`, and how to enable/disable seeded signal definitions.

## Risks / Open Questions

- R1: `cdm.generic.filter` could become a de facto query DSL; we mitigate by keeping v1 simple and well-documented.
- R2: Seeded signals might be noisy in some environments; defaulting them to `DISABLED` and requiring explicit activation mitigates surprise.
- Q1: Do we need a first-class "pack" entity, or are naming conventions and metadata enough for v1? This slug assumes the latter and leaves a pack model for a later iteration.
