- title: Signals surfaces & filters v1
- slug: signals-surfaces-and-filters-v1
- type: feature
- context:
  - apps/metadata-api/src/signals/* (SignalDefinition/SignalInstance, evaluator, store)
  - apps/metadata-api/src/cdm/* (CdmWorkStore, CdmDocStore, CDM GraphQL types)
  - apps/metadata-ui (CDM explorers, KB console, nav shell)
  - signals-epp-foundation-v1 (EPP framing)
  - signals-evaluator-scaling-v1 (paged evaluation + reconciliation)
  - signals-extensibility-and-packs-v1 (implMode, sourceFamily, packs, cdm.generic.filter)
  - cdm-core-model-and-semantic-binding-v1 / cdm-docs-model-and-semantic-binding-v1
  - cdm-source-provenance-v1 (sourceSystem/sourceId/sourceUrl/rawSource)
- why_now: The signals pipeline is now scalable, expressive, and seeded with signal packs for Jira/Confluence/docs, but there is no first-class way to explore, filter, and act on signals in the UI or via simple Brain APIs. To unlock agentic and human workflows—and to prepare for KG/Brain—we need a dedicated Signals surface with rich filters and tight linking to CDM entities and source systems.
- scope_in:
  - Add a top-level Signals exploration API in metadata-api (GraphQL) that supports:
    - Filtering by sourceFamily, entityKind, policyKind, severity, status, definitionSlug, and time window.
    - Fetching signals for a specific entityRef (per CDM work/doc row).
  - Create a Signals UI surface in metadata-ui:
    - A list/table of SignalInstances with filters and basic sorting.
    - Per-row affordances to jump to the associated CDM entity and to the source system via sourceUrl.
  - Add lightweight signals surfacing on CDM detail pages (work/doc):
    - Show when an entity has active signals.
    - Link to the Signals view pre-filtered for that entity.
  - Ensure the GraphQL contracts are generic enough for future KG/Brain use (Workspace, agents).
- scope_out:
  - New KG structures or lineage edges for signals (will be handled in lineage/KG slugs).
  - Real-time push/notifications or inbox-style UX (Workspace-level scope).
  - Complex signal authoring UI (covered by a potential signals-authoring slug).
- acceptance:
  1. GraphQL exposes query/fields to list and filter SignalInstances and to fetch signals for a given entityRef with EPP/source metadata.
  2. A Signals UI view exists with filters on severity/status/sourceFamily/entityKind/policyKind/definitionSlug and basic pagination.
  3. CDM work/doc detail views surface active signals and link into the Signals view for that entity.
  4. GraphQL APIs and UI changes are covered by tests (unit + Playwright) and remain backward compatible.
  5. `pnpm ci-check` remains green.
- constraints:
  - No breaking changes to existing GraphQL schema; only additive fields/queries or new root queries.
  - Respect existing auth/role model for signals access; do not expose signals to unauthorized roles.
  - UI must follow existing loading/error/feedback patterns (local + global indicators where available).
- non_negotiables:
  - It must be possible to answer “what signals are currently open on this CDM work/doc item?” via GraphQL and in the UI.
  - It must be possible to filter signals by at least severity, status, and sourceFamily in the Signals view.
  - Each signal row in the UI must provide a clear path to the associated CDM entity and, where available, the upstream sourceUrl.
- refs:
  - intents/signals-epp-foundation-v1/*
  - intents/signals-evaluator-scaling-v1/*
  - intents/signals-extensibility-and-packs-v1/*
  - docs/meta/nucleus-architecture/STORES.md (signals, CDM)
  - docs/meta/nucleus-architecture/UI-UX.md (if present for loading/feedback patterns)
- status: in-progress
