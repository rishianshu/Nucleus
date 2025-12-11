# Signals & EPP Model (v1)

This note defines the first-class Signals model for Nucleus. Signals capture durable, evaluated facts about entities and processes (EPP) so downstream apps and agents can answer “what is important/broken/notable right now?” without re-deriving state from CDM/KB each time.

## Core entities

**SignalDefinition** — describes *what* to evaluate.
- `slug`, `title`, `description`, `status` (`ACTIVE|DISABLED|DRAFT`)
- EPP classification: `entityKind`, `processKind?`, `policyKind?`
- `severity` (`INFO|WARNING|ERROR|CRITICAL`), `tags`, `owner?`
- `cdmModelId?` (e.g., `cdm.work.item`, `cdm.doc.item`) for grounding
- `definitionSpec` (JSON) — opaque payload for future DSL/config
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

## GraphQL (read-only, v1)
- Enums: `SignalStatus`, `SignalInstanceStatus`, `SignalSeverity`.
- Types/queries: `signalDefinitions`, `signalDefinition(slug)`, `signalInstances`, `signalInstance(id)`.
- Scoped by existing auth (viewer+); mutations remain internal for evaluators until a DSL/UX is added.

## Relationship to CDM and KB
- `entityRef` should use stable IDs already present in CDM/KB (e.g., `cdm.work.item:<id>`, `cdm.doc.item:<id>`, or KB node IDs). This keeps Signals composable with graph projections later.
- `cdmModelId` on definitions documents the source model; future KB projections can materialize edges like `signal -> entity`.
- EPP fields (`entityKind`, `processKind`, `policyKind`) let Workspace/Brain slice signals without knowing evaluator internals.

## Seeds (v1)
- Definitions seeded via migration:
  - `work.stale_item` (WORK_ITEM, policy=FRESHNESS)
  - `doc.orphaned` (DOC, policy=OWNERSHIP)
- Sample instances seeded for visibility; evaluators will replace these with real observations in later slugs.

## Future work (out of scope for v1)
- Signal DSL + evaluator runtimes, scheduling, and re-evaluation policies.
- SignalBus/event streaming and KB projection of signals → entities.
- UI surfacing of signals and overrides (suppress/resolve flows).
