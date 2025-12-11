- title: Signals extensibility & packs v1
- slug: signals-extensibility-and-packs-v1
- type: feature
- context:
  - signals-epp-foundation-v1 (SignalDefinition/SignalInstance/SignalStore)
  - signals-dsl-and-evaluator-v1 (Signal DSL, work-stale/doc-orphan)
  - signals-evaluator-scaling-v1 (paged evaluation + reconciliation)
  - cdm-core-model-and-semantic-binding-v1 (CDM Work)
  - cdm-docs-model-and-semantic-binding-v1 (CDM Docs)
  - cdm-source-provenance-v1 (source_id/source_url/raw_source on CDM)
  - semantic-jira-source-v1 / semantic-confluence-source-v1 / OneDrive semantic slugs
- why_now: We now have a working Signal DSL, a scalable evaluator, and provenance-aware CDM models. However, adding new signals still requires code changes (hard-coded evaluator branches) and there is no structured catalog of "signal packs" per source. We want Nucleus to ship with a rich, mostly DSL-driven library of signals for Jira/Confluence/Docs that can be enabled without modifying core code, while keeping room for a small number of code-backed "advanced" signals.
- scope_in:
  - Introduce an explicit implementation mode for SignalDefinitions (e.g., DSL vs code-backed) and a registry of evaluators keyed by `spec.type`.
  - Add at least one generic DSL signal type (e.g., `cdm.generic.filter`) that can express common conditions across CDM models (work, docs, datasets later).
  - Refine SignalDefinition metadata to capture EPP-like semantics (entity/process/policy classifications) and source families (jira, confluence, onedrive, generic).
  - Seed one or more "signal packs" per source (Jira Work, Confluence Docs, Docs/Files) expressed via DSL, and ensure they can be enabled/disabled via configuration or status.
  - Document how to add new signals without touching evaluator core (when DSL is sufficient) and when a code-backed signal is justified.
- scope_out:
  - Real-time streaming SignalBus or event-based triggers.
  - New UI surfaces for signals beyond what already exists (e.g., full Workspace integration).
  - Lineage/KG projection of signals (will be handled separately).
- acceptance:
  1. SignalDefinition model supports an implementation mode and EPP/source-family metadata needed for organizing and discovering signals.
  2. Evaluator dispatch is driven by a registry of handlers keyed by `spec.type`, with a clear distinction between DSL-only and code-backed types.
  3. A generic DSL type (e.g., `cdm.generic.filter`) is implemented and used to define multiple signals without adding new evaluation code.
  4. Seeded signal packs for at least Jira Work and Confluence Docs (and optionally OneDrive Docs) exist, are expressed via DSL, and can be enabled for an environment.
  5. Documentation explains how to author new signals, how to use the DSL vs code, and how to enable/disable signal packs.
- constraints:
  - All changes must be backward compatible with existing SignalDefinitions and the current evaluator interface.
  - The DSL should remain JSON-based and versioned; no arbitrary code or unbounded expressions.
  - Seeded definitions should default to a safe state (e.g., DISABLED/DRAFT) so they do not surprise existing environments.
- non_negotiables:
  - Adding a new DSL-only signal must not require changes to the evaluator core; it should be a matter of inserting a new definition row with a supported `spec.type`.
  - Evaluator must fail closed on unknown or misconfigured types (logged + skipped), not silently degrade.
  - Seeded packs must be deterministic (no environment-specific surprises) and have clear slugs/names.
- refs:
  - intents/signals-epp-foundation-v1/*
  - intents/signals-dsl-and-evaluator-v1/*
  - intents/signals-evaluator-scaling-v1/*
  - docs/meta/nucleus-architecture/STORES.md (SignalStore section)
  - docs/meta/nucleus-architecture/CDM-*.md
  - index-req.md (signals / Brain / Workspace requirements, if present)
- status: in-progress
