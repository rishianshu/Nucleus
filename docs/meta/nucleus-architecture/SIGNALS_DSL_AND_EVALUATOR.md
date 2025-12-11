# Signals DSL & Evaluator (v1)

This note documents the v1 Signal DSL stored in `SignalDefinition.definitionSpec` and the batch evaluator that materializes SignalInstances from CDM Work/Docs. It extends the foundations in `SIGNALS_EPP_MODEL.md`.

## DSL Envelope

```ts
type SignalDefinitionSpecV1 = {
  version: 1;
  type: "cdm.work.stale_item" | "cdm.doc.orphan";
  config: Record<string, unknown>;
};
```

- Entity refs emitted by evaluators should use `cdm.work.item:<id>` / `cdm.doc.item:<id>` prefixes.
- Unknown `type` values fail closed (logged/skipped, no partial writes).
- `cdmModelId` in config must align with the definition-level `cdmModelId`.

### Supported types

**cdm.work.stale_item**
- `cdmModelId: "cdm.work.item"` (required)
- `maxAge` `{unit: "days"|"hours", value: number}` (required)
- `statusInclude?`, `statusExclude?`, `projectInclude?`, `projectExclude?` (string arrays)
- `severityMapping?` `{warnAfter?, errorAfter?}` (age thresholds override default severity)
- Semantics: work items whose last activity (`updated_at`/`closed_at` fallback `created_at`) exceeds `maxAge` and pass filters produce OPEN signals with severity derived from `severityMapping` (else the definition’s default).

**cdm.doc.orphan**
- `cdmModelId: "cdm.doc.item"` (required)
- `minAge` `{unit: "days"|"hours", value: number}` (required)
- `minViewCount?` (docs below this are “orphan-ish”)
- `requireProjectLink?` (if true, skip docs that advertise project/work links in properties)
- `spaceInclude?`, `spaceExclude?` (optional scoping)
- Semantics: docs older than `minAge` with low view counts and no required linkage produce OPEN signals.

## Evaluator behaviour

- Loads ACTIVE SignalDefinitions (optionally filtered by slug) and parses `definitionSpec` as v1 DSL.
- Dispatches per `type` to fetch CDM rows (`cdm_work_item`, `cdm_doc_item`), compute candidates, and upsert via `SignalStore.upsertInstance` keyed by `(definitionId, entityRef)`.
- CDM work/doc rows are processed page-by-page via store pagination to avoid materializing whole tables in memory.
- SignalInstance reconciliation uses paged SignalStore reads (no fixed 200-instance cap) and resolves unmatched OPEN instances after each definition.
- Idempotent: repeated runs update `lastSeenAt`/summary/severity without duplicating instances.
- Resolution: OPEN instances that no longer match are updated to `RESOLVED` with the current evaluation timestamp.
- Dry run: `dryRun: true` returns would-be counts without persisting instances.
- Signals are batch/slow-path by design; use `sourceRunId`/`dryRun` for traceability rather than expecting realtime responses.
- Unsupported DSL `type` values or per-definition errors are recorded in `skippedDefinitions` without aborting other definitions.

### Entrypoints
- **GraphQL**: `mutation evaluateSignals(definitionSlugs?, dryRun?) : SignalEvaluationSummary` (admin/service-only). Returns evaluated + skipped slugs and instance counts (created/updated/resolved).
- **CLI**: `pnpm --filter @apps/metadata-api exec tsx src/signals/evaluateSignals.cli.ts --defs work.stale_item,doc.orphaned --dry-run`.

## Authoring new DSL signals
1. Create/patch a `SignalDefinition` with `definitionSpec.version = 1`, `type` set to a supported evaluator, and `config` matching the schema above. Keep `cdmModelId` and `entityKind` aligned.
2. Ensure entity refs follow `cdm.<domain>.<model>:<cdm_id>` to stay graph-friendly.
3. Add seeds/fixtures plus tests that run the evaluator twice to verify idempotency and resolution.
4. Extend the evaluator with a new handler before adding new `type` values.

## Seeds & testing
- Migrations seed DSL-backed definitions `work.stale_item` and `doc.orphaned`.
- Signals tests (`pnpm --filter @apps/metadata-api test:signals`) cover the evaluator dispatch, idempotency, and example staleness/orphan scenarios.
