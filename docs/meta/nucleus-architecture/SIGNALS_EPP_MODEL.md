# Signals & EPP Model (v1)

This note defines the first-class Signals model for Nucleus. Signals capture durable, evaluated facts about entities and processes (EPP) so downstream apps and agents can answer “what is important/broken/notable right now?” without re-deriving state from CDM/KB each time.

## Core entities

**SignalDefinition** — describes *what* to evaluate.
- `slug`, `title`, `description`, `status` (`ACTIVE|DISABLED|DRAFT`)
- `implMode` (`DSL|CODE`, default `DSL`) and `sourceFamily?` (`jira`, `confluence`, etc.)
- EPP classification: `entityKind?`, `processKind?`, `policyKind?`
- `severity` (`INFO|WARNING|ERROR|CRITICAL`), `tags`, `owner?`, `surfaceHints?` (JSON UI hints such as recommended views)
- `cdmModelId?` (e.g., `cdm.work.item`, `cdm.doc.item`) for grounding
- `definitionSpec` (JSON) — versioned Signal DSL payload (`version`, `type`, `config`); see `SIGNALS_DSL_AND_EVALUATOR.md`
- Timestamps: `createdAt`, `updatedAt`

**SignalInstance** — evaluated fact for a specific entity.
- FK → `definitionId`, `status` (`OPEN|RESOLVED|SUPPRESSED`)
- `entityRef` (stable CDM/KB identifier), `entityKind`
- `severity`, `summary`, `details?` (JSON evidence)
- `firstSeenAt`, `lastSeenAt`, `resolvedAt?`
- `sourceRunId?` to trace the evaluator run
- Timestamps: `createdAt`, `updatedAt`

## Storage (SignalStore)
- **Tables:** `signal_definitions`, `signal_instances` (see Prisma models/migration).
- **Indexes:** `(definition_id,status)`, `(entity_ref,definition_id)`, `(entity_kind,status,severity)`.
- **Interface:** `SignalStore` (TS) provides CRUD for definitions, list/get for instances, idempotent `upsertInstance` keyed by `{definitionId, entityRef}`, and `updateInstanceStatus`.
- **Separation:** SignalStore is distinct from event logs (SignalBus), CDM, GraphStore, and KvStore. It stores evaluated state, not raw events.

## GraphQL (signals v1)
- Enums: `SignalStatus`, `SignalInstanceStatus`, `SignalSeverity`.
- Types/queries: `signalDefinitions`, `signalDefinition(slug)`, `signalInstances`, `signalInstance(id)`.
- Mutation (admin/service): `evaluateSignals(definitionSlugs?, dryRun?)` runs the DSL-backed evaluator and returns a summary (evaluated/skipped slugs, instance counts).
- Scoped by existing auth (viewer+ for reads; admin/service for evaluation), keeping mutations internal while authoring UX matures.

## Relationship to CDM and KB
- `entityRef` should use stable IDs already present in CDM/KB (e.g., `cdm.work.item:<id>`, `cdm.doc.item:<id>`, or KB node IDs). This keeps Signals composable with graph projections later.
- `cdmModelId` on definitions documents the source model; future KB projections can materialize edges like `signal -> entity`.
- EPP fields (`entityKind`, `processKind`, `policyKind`) let Workspace/Brain slice signals without knowing evaluator internals.

## Seeds (v1)
- Definitions seeded via migration use the DSL envelope:
  - `work.stale_item` (`cdm.work.stale_item`, policy=FRESHNESS)
  - `doc.orphaned` (`cdm.doc.orphan`, policy=OWNERSHIP)
- Additional DSL pack definitions (status=DRAFT) are seeded for Jira and Confluence: `jira.work.stale_item.default`, `jira.work.unassigned_blocker`, `jira.work.reopened_often`, `confluence.doc.orphan`, `confluence.doc.stale_low_views`.
- Sample instances remain for visibility; the DSL evaluator (GraphQL/CLI) produces real instances idempotently.

See `SIGNALS_DSL_AND_EVALUATOR.md` for the DSL schema, evaluation flow, and authoring guidance.

## Future work (out of scope for v1)
- Signal DSL + evaluator runtimes, scheduling, and re-evaluation policies.
- SignalBus/event streaming and KB projection of signals → entities.
- UI surfacing of signals and overrides (suppress/resolve flows).
