# Ingestion & Sink Architecture

This file complements `docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md`, which captures the canonical Source → Staging → Sink data-plane. The summary below focuses on how the TypeScript control plane and Python runtime interact today.

## Canonical Data-Plane (recap)

- Source/Sink endpoints live in Python (`platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*`).
- Staging buffers slices between endpoints (`runtime_common/staging.py`, `ingestion_runtime/ingestion/runtime.py`).
- Sink endpoints persist rows to external systems (HDFS, Iceberg, JDBC/CDM).
- The TypeScript side **does not** implement a second endpoint registry. Instead, it orchestrates runs and updates KV/Prisma/KB.

See the dedicated Source–Staging–Sink spec for diagrams and code pointers. Endpoints now expose logical units (`EndpointUnitDescriptor`) and optional incremental planning helpers (`SupportsIncrementalPlanning`) so the worker can request slices directly from the source rather than re-implementing planning inside workflows.

## Control-Plane (TypeScript)

1. **GraphQL layer** (`apps/metadata-api/src/schema.ts`):
   - Queries: `ingestionUnits`, `ingestionStatuses`, `ingestionStatus`.
   - Mutations: `startIngestion`, `pauseIngestion`, `resetIngestionCheckpoint`.
   - Resolvers read endpoint configs, manage Prisma `IngestionUnitState`, and enqueue `ingestionRunWorkflow`.

2. **Temporal workflow** (`apps/metadata-api/src/temporal/workflows.ts`):
   - `startIngestionRun` (TS activity) → loads KV checkpoint (`apps/metadata-api/src/ingestion/checkpoints.ts`), marks Prisma state, resolves sink/staging defaults.
   - `pythonActivities.runIngestionUnit` (new) → hands `{ endpointId, unitId, sinkId?, stagingProviderId?, checkpoint, policy }` to the Python worker (`platform/spark-ingestion/temporal/metadata_worker.py`), which will invoke Source→Staging→Sink logic. Workers can call `list_units` / `plan_incremental_slices` on the endpoint to break the run into adaptive slices and publish intermediate updates.
   - `completeIngestionRun` / `failIngestionRun` (TS activities) → write checkpoint back to KV, update `IngestionUnitState`, persist run stats.
   - TypeScript no longer streams `NormalizedBatch` payloads; bulk data stays in Python.

3. **UI** (`apps/metadata-ui/src/ingestion/IngestionConsole.tsx`):
   - Lists endpoints/units using GraphQL.
   - Triggers mutations with ADR-compliant feedback (toast + inline cues).
   - Shows status info sourced from Prisma + KV stats.

## Metadata-first contract

Ingestion is grounded in the metadata catalog. Before a unit can appear in the console or be enqueued via GraphQL:

- The endpoint must be registered (descriptor + config stored via `MetadataEndpoint`).
- The metadata subsystem must have produced catalog datasets for that endpoint (`CatalogSnapshot` emitted via `collectCatalogSnapshots`). Only datasets that exist in `catalog.dataset` may expose ingestion units.
- `listUnits` implementations must simply reflect the dataset catalog; if the catalog is empty (e.g., collection never ran) the API returns no units and the UI shows the empty state.

This ensures orchestration never targets phantom datasets and keeps ingestion policies in sync with what the metadata workspace knows about the source.

## Python Worker Highlights

- `metadata_worker.py` registers Temporal activities (`collectCatalogSnapshots`, `previewDataset`, `runIngestionUnit`).
- `runIngestionUnit` is responsible for calling the Spark ingestion runtime (`ingestion_runtime/run_ingestion`) with the correct Source/Sink descriptors and staging provider.
- Future semantic sources plug into this worker by implementing SourceEndpoints + table/unit configs; Stage + Sink wiring stays inside Python.

## Legacy TypeScript Helpers

`packages/metadata-core/src/index.ts` still exports `IngestionDriver` / `IngestionSink` interfaces plus `KnowledgeBaseSink` utilities. They remain useful for local tests and KB-only experiments but are no longer the production contract. Documentation and workflows now treat them as **legacy helpers**.

## Current Sink Targets

| Sink | Implementation | Notes |
|------|----------------|-------|
| HDFS / RAW | `runtime_common/endpoints/hdfs/parquet.py` | Spark ingestion runtime default; writes raw files and publishes Hive tables. |
| Iceberg / warehouse | `runtime_common/endpoints/hdfs/warehouse.py` | Extends Parquet sink with Iceberg finalize/merge helpers. |
| KB enrichment | `KnowledgeBaseSink` (`apps/metadata-api/src/ingestion/kbSink.ts`) | Optional TS helper for emitting metadata into GraphStore when the Python worker returns normalized entities. |

## State & Persistence

- **KV store** – checkpoint + run stats; default file-backed driver under `metadata/kv-store.json`, configurable via `INGESTION_KV_FILE`.
- **Prisma** – `IngestionUnitState` rows track state, last run IDs, timestamps.
- **KB** – Graph metadata for console explorers (`apps/metadata-api/src/schema.ts` KB queries).

## KB scope vs. data views

The Knowledge Base stores semantic entities (projects, issues, users, lineage edges). It is *not* the final repository for bulk ingested data. When an ingestion unit publishes KB nodes, that is purely for context/reasoning, not for row-level storage. The underlying Source→Staging→Sink pipeline continues to land data in the configured sink (lakehouse, CDM, etc.). A future UI will expose that ingested data; in the meantime dataset detail panes can display ingestion stats/checkpoints to tie catalog entries to ingestion runs.

## Remaining Gaps

- **Python ingestion worker** still needs full integration with Source→Staging→Sink flow per unit (current activity is a thin shim; future slugs will wire `ingestion_runtime` for specific vendors).
- **Semantic drivers** (Jira/Confluence/OneDrive) are pending; TypeScript orchestration is ready once Python workers expose units.
- **Non-KB sinks** accessible from TypeScript (e.g., CDM/JDBC connectors) will arrive once SinkEndpoints expose metadata to orchestration.
