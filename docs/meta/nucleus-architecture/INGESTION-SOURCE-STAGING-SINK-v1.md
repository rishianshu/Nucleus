# Ingestion Source → Staging → Sink (v1)

This note records the canonical ingestion data-plane for Nucleus following the `ingestion-source-staging-sink-v1` slug. It ties the Spark/Python runtime to the Temporal/TypeScript control plane so future semantic sources (Jira/Confluence/OneDrive) and sinks can rely on a single contract.

## Roles & Single Endpoint Plane

| Layer | Responsibilities | Implementation |
|-------|------------------|----------------|
| **SourceEndpoint** | Connects to upstream systems (JDBC, HTTP, streams) and exports rows. Capabilities include `metadata.collect`, `metadata.preview`, `ingest.full`, `ingest.incremental`. | Python classes in `platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*` (e.g., `jdbc_postgres.py`, `http_rest.py`). |
| **StagingProvider** | Buffers exported rows between Source and Sink. Handles `writer()` / `reader()` lifecycles, TTL cleanup, and reuse across slices. | Python module `runtime_common/staging.py` plus higher-level helpers in `ingestion_runtime` (Spark-backed staging directories today; in-memory provider coming next). |
| **SinkEndpoint** | Writes staged rows into external stores (HDFS, Iceberg, JDBC/CDM). Emits provenance/state events but does **not** touch KB. | Python classes in `runtime_common/endpoints/hdfs/*`, `warehouse.py`, etc. |
| **TypeScript orchestration** | GraphQL, Temporal workflows, KV checkpoints, Prisma `IngestionUnitState`, KB updates, and calling Python ingestion activities. | `apps/metadata-api/src/schema.ts`, `apps/metadata-api/src/temporal/{activities.ts,workflows.ts}`, `apps/metadata-api/src/ingestion/*`. |

All Source/Sink descriptors remain defined **only** in Python. TypeScript reads their descriptors via `metadataEndpointTemplates` and stores user configs in Prisma (`prisma/metadata/schema.prisma – MetadataEndpoint`).

## Staging Provider Contract

Staging abstracts how records travel between endpoints:

```python
class StagingProvider(Protocol):
    def allocate_session(self, context: IngestionContext) -> "StagingSession": ...

class StagingSession(Protocol):
    id: str

    def writer(self) -> "RecordWriter": ...
    def reader(self) -> "RecordReader": ...
    def close(self) -> None: ...
```

* `RecordWriter.write_batch(batch: Iterable[Row])` streams rows from a SourceEndpoint into staging.
* `RecordReader.iter_batches(chunk_size: int)` streams rows from staging into SinkEndpoints (or special sinks such as KB/CDM writers).
* Initial provider defaults to **in-memory / local staging**; `runtime_common/staging.py` already contains helpers for Spark/HDFS staging directories.

## Data-Plane Lifecycle (per unit)

1. **Export (Source → staging)**  
   `ingestion_runtime/ingestion/runtime.py` builds the SourceEndpoint using `EndpointFactory`. It reads either full datasets or incremental slices, writing each slice via `staging_session.writer()`. It returns `{ new_checkpoint, stats }`.

2. **Import (staging → Sink)**  
   SinkEndpoint instances consume rows via `staging_session.reader()` and persist them (raw/HDFS, merge/Iceberg, CDM tables, etc.). Sink endpoints emit telemetry (`ingestion_runtime/events`, `runtime_common/state`) but **do not** talk to KB.

3. **Cleanup**  
   The StagingSession closes (creating `_SUCCESS` / `_LANDED` markers). TTL cleanup is handled via `Staging.ttl_cleanup`.

Python entry point:  
`platform/spark-ingestion/ingestion.py` → `ingestion_runtime.run_cli()` → `ingestion_runtime/ingestion/run_ingestion`.

## Control Plane (TypeScript)

1. **GraphQL/Resolvers** (`apps/metadata-api/src/schema.ts`)  
   Expose `ingestionUnits`, `ingestionStatuses`, `startIngestion`, etc. Mutations are unchanged—the slug only swaps the implementation behind the workflow.

2. **Temporal Workflow** (`apps/metadata-api/src/temporal/workflows.ts`)  
   `ingestionRunWorkflow` now performs:
   - `startIngestionRun` (TS activity) → loads checkpoint (KV: `apps/metadata-api/src/ingestion/checkpoints.ts`), marks Prisma `IngestionUnitState`.
   - `pythonActivities.runIngestionUnit` → hands `{ endpointId, unitId, checkpoint, sinkId?, stagingProviderId?, policy? }` to `platform/spark-ingestion/temporal/metadata_worker.py`.
   - `completeIngestionRun` / `failIngestionRun` (TS activities) → persist checkpoint + stats, update `IngestionUnitState`.

3. **Python Activity** (`metadata_worker.py`)  
   Registers `@activity.defn(name="runIngestionUnit")` which will call into the Spark ingestion runtime (full integration in follow-up slugs). The activity is the canonical place to invoke Source→Staging→Sink logic—TS no longer streams `NormalizedRecord` batches itself.

4. **KB (GraphStore)**  
   When ingestion needs to surface semantic metadata (e.g., Jira issues), the Python worker emits summary stats or normalized metadata which TS can convert into KB nodes/edges using `graphStore.upsertEntity`. This is orthogonal to data persistence in sinks.

5. **KV**  
   Checkpoints and operational stats remain in the KV store managed via `createKeyValueStore` (default `metadata/kv-store.json`). Keys remain `ingest::<vendor>::endpoint::<endpointId>::unit::<unitId>::sink::<sinkId?>`.

## KB vs Sink vs KV

- **KV store** → operational state (`lastRunId`, `cursor`, `stats`). Implemented in `apps/metadata-api/src/ingestion/checkpoints.ts`.
- **KB (GraphStore)** → connected metadata / knowledge (endpoints, datasets, semantic entities). Writes happen via `graphStore.upsertEntity` and the KB React console (`apps/metadata-ui/src/knowledge-base/*`).
- **SinkEndpoints** → actual data persistence (raw files, warehouses, CDM tables). Implemented in Python (Spark ingestion runtime).

These three concerns stay separate—TypeScript orchestrates them but data-plane work happens in Python.

## Legacy Helpers

`packages/metadata-core` still exposes `IngestionDriver` / `IngestionSink` interfaces for tests and backwards compatibility, but they are now considered **legacy helpers**. Production ingestion flows must go through the Python activity and the Source→Staging→Sink pipeline described here.
