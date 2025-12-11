# Acceptance Criteria

1) DSL schema is defined and wired into SignalDefinition.definitionSpec  
   - Type: schema / docs  
   - Evidence:
     - A documented JSON structure for `SignalDefinitionSpecV1` exists, with fields `version`, `type`, and `config`.
     - At least two concrete `type` values are supported: `cdm.work.stale_item` and `cdm.doc.orphan`.
     - Existing example definitions from signals-epp-foundation-v1 are updated (or recreated) to use the DSL and reference `cdmModelId` correctly.

2) Signal evaluator loads definitions and upserts instances via SignalStore  
   - Type: unit / integration  
   - Evidence:
     - A `SignalEvaluator` (or equivalent) is implemented in TypeScript and depends on:
       - `SignalStore` for definitions and instances,
       - CDM access layer for work/docs.
     - Unit tests verify that:
       - Supported `type` values dispatch to the correct evaluation functions.
       - Unknown or malformed `definitionSpec` cause a logged skip, not a crash.
       - `upsertInstance` is called with correct `(definitionId, entityRef)` and severity/summary/details.

3) GraphQL mutation or CLI entrypoint triggers evaluation and returns summary  
   - Type: integration  
   - Evidence:
     - GraphQL schema includes a mutation `evaluateSignals(definitionSlugs, dryRun)` returning a summary with evaluated/skipped definitions and instance counts, OR a documented CLI script provides equivalent functionality.
     - At least one integration test invokes evaluation (non-dry-run) and asserts that:
       - The summary includes the known test slugs.
       - InstancesCreated/InstancesUpdated counts are consistent with seeded data.
     - Access control rules are documented (e.g., admins only).

4) Work-stale and doc-orphan signals produce instances from seeded CDM data  
   - Type: integration  
   - Evidence:
     - Test fixtures or migration seed:
       - A few `cdm.work.item` rows with varying `last_activity_at`, status, project.
       - A few `cdm.doc.item` rows with varying age, view counts, and linkage.
     - SignalDefinitions are created using the DSL for:
       - `cdm.work.stale_item` (e.g., items older than N days and not in Done).
       - `cdm.doc.orphan` (e.g., docs older than N days with low views and no project link).
     - Running the evaluator in tests yields:
       - OPEN SignalInstances for entities that match the conditions.
       - No instances for entities that do not match.
       - Re-running the evaluator does not create duplicate instances for the same entity/definition.

5) Documentation explains authoring DSL-based signals and evaluator behaviour  
   - Type: docs  
   - Evidence:
     - A doc (e.g., `docs/meta/nucleus-architecture/SIGNALS_DSL_AND_EVALUATOR.md`) describes:
       - The v1 DSL envelope (version/type/config).
       - The two supported types and their config fields.
       - How the evaluator reads definitions, queries CDM, and uses SignalStore.
       - How to add a new signal using one of the existing types.
     - `STORES.md` and/or related architecture docs mention that SignalStore is consumed by the evaluator and remains distinct from event logs.

6) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes with new models, code, tests, and GraphQL schema additions.
     - No existing tests are disabled or skipped to make this slug pass.
