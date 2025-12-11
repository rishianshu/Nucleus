- title: Signals DSL & evaluator v1
- slug: signals-dsl-and-evaluator-v1
- type: feature
- context:
  - signals-epp-foundation-v1 models (SignalDefinition, SignalInstance, SignalStore)
  - docs/meta/nucleus-architecture/STORES.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - CDM work/docs models and explorers
  - KB / GraphStore schemas and KB admin console
- why_now: Signals & EPP foundation v1 introduced typed SignalDefinition/SignalInstance models and a SignalStore, but there is no standard way to express "how to compute this signal" or a reusable engine to evaluate them. We want Nucleus to answer "what's important / broken / notable?" across CDM work/docs so downstream apps (Workspace) and agents can rely on it. To do that, we need a small DSL for signal logic and a batch evaluator that runs against CDM and writes back SignalInstances.
- scope_in:
  - Define a minimal, declarative Signal DSL for CDM-backed signals, stored in `SignalDefinition.definitionSpec`.
  - Implement a TypeScript evaluator that:
    - Loads active SignalDefinitions from SignalStore,
    - Evaluates them against CDM Work/Docs,
    - Upserts SignalInstances via SignalStore with correct idempotency.
  - Add a GraphQL mutation and/or CLI entrypoint to trigger evaluations for one or more signals (or all active).
  - Provide at least two concrete signal types implemented via the DSL:
    - A work-centric freshness/staleness signal for `cdm.work.item`,
    - A doc-centric orphan/completeness signal for `cdm.doc.item`.
  - Add tests (unit + integration) using synthetic CDM data to verify instances are created and updated as expected.
- scope_out:
  - Continuous scheduling or cron pipelines for signals (will be a later slug).
  - Full-blown SignalBus / streaming / real-time eventing.
  - Rich UI surfacing of signals in KB or Workspace (covered by future slugs).
  - Generic Query DSL that can express arbitrary SQL/graph queries across all stores.
- acceptance:
  1. A versioned Signal DSL schema is documented and stored in `definitionSpec`, with at least one concrete `type` for work and one for docs.
  2. A batch evaluator service can evaluate all ACTIVE definitions (or a subset) and upsert SignalInstances via SignalStore, idempotently.
  3. A GraphQL mutation and/or CLI entrypoint exists to trigger evaluation and returns basic metrics (e.g., evaluated definitions, instances created/updated).
  4. At least two example signals (work-stale, doc-orphaned or similar) are expressed in the DSL and produce instances from seeded CDM data in tests.
  5. Documentation explains how to author new signals using the DSL and how evaluators interact with CDM and SignalStore.
- constraints:
  - DSL must be machine-readable JSON with a clear `version` and `type`, not arbitrary free-form text.
  - Evaluator must be deterministic and idempotent for the same CDM snapshot and definitions.
  - No changes to ingestion/UCL data-plane are allowed beyond reading CDM tables; signals are derived from existing state.
  - GraphQL additions must be backward compatible and keep `pnpm ci-check` green.
- non_negotiables:
  - Signal evaluation must upsert instances by `(definitionId, entityRef)` (no duplicate open instances per entity/definition).
  - Failing or unknown DSL types must fail closed (logged + skipped) rather than partially updating instances.
  - DSL v1 must be extensible (new `type`s and fields) without breaking existing definitions.
- refs:
  - intents/signals-epp-foundation-v1/*
  - docs/meta/nucleus-architecture/STORES.md
  - CDM work/docs specs
  - index-req.md (signals/index/Workspace requirements)
- status: in-progress
