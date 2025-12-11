- title: Signals evaluator scaling v1
- slug: signals-evaluator-scaling-v1
- type: techdebt
- context:
  - apps/metadata-api/src/signals/evaluator.ts
  - apps/metadata-api/src/signals/types.ts
  - apps/metadata-api/src/signals/store/* (SignalStore implementation)
  - apps/metadata-api/src/cdm/workStore.ts
  - apps/metadata-api/src/cdm/docStore.ts
  - signals-epp-foundation-v1 (SignalDefinition/SignalInstance/SignalStore contract)
- why_now: The current signals evaluator works correctly for small data sets but does not scale safely for larger CDM tables or many signal instances. It accumulates all work/docs rows in memory, only reconciles against the first page of instances (MAX_PAGE_SIZE=200), and stops on the first definition-level error. Signals are slow-path and do not need an immediate response, but we do need a robust, linear evaluation design that can handle growth without correctness bugs.
- scope_in:
  - Refactor the evaluator to process CDM rows page-by-page instead of materializing all rows in memory.
  - Remove the hard 200-instance cap by paginating SignalInstances or using a run-token strategy for resolution (OPEN→RESOLVED).
  - Improve definition-level error handling so one bad definition does not abort the entire evaluation.
  - Make handling of unknown/unsupported DSL types explicit (logged + skipped).
  - Keep the public EvaluateSignalsOptions / SignalEvaluationSummary contract stable for existing callers.
- scope_out:
  - Moving signal evaluation into Temporal workflows (can be a follow-up slug).
  - Adding new signal types, a registry, or DSL extensions (covered by a signals-extensibility slug).
  - Lineage/graph projection of signal instances (cdm-lineage / KG work).
- acceptance:
  1. Evaluator processes work/docs in pages without holding the full CDM table in memory and without changing external behavior.
  2. Evaluator reconciles against all relevant SignalInstances for a definition (no 200-instance cap), and OPEN→RESOLVED behavior remains correct.
  3. Unknown or unsupported DSL types are explicitly recorded as skipped, not silently treated as successes.
  4. A failure evaluating one definition does not prevent other definitions from being evaluated; errors are captured in the summary.
  5. Tests and documentation are updated to reflect the paged, resilient evaluator behavior and `pnpm ci-check` remains green.
- constraints:
  - No breaking changes to the existing GraphQL API or SignalStore public interface; only additive changes or internal refactors.
  - Keep the evaluator deterministic and idempotent for the same CDM snapshot and signal definitions.
  - Avoid introducing Temporal dependencies in this slug; remain synchronous from the caller's perspective.
- non_negotiables:
  - Evaluation must no longer rely on a fixed MAX_PAGE_SIZE of instances; all relevant instances must be considered for reconciliation.
  - OPEN instances that no longer match a signal condition must still be resolvable without scanning everything into memory at once.
  - Errors in one definition must not corrupt or skip evaluations of other definitions.
- refs:
  - intents/signals-epp-foundation-v1/*
  - docs/meta/nucleus-architecture/STORES.md (SignalStore section)
  - index-req.md (signals/Brain API context, if present)
- status: in-progress
