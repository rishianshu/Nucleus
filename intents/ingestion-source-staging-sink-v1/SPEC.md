### `intents/ingestion-source-staging-sink-v1/SPEC.md`

````markdown
# SPEC — Ingestion Source–Staging–Sink v1

## Problem

Ingestion-core v1 currently models ingestion in TypeScript using `IngestionDriver` and `IngestionSink`, with a `KnowledgeBaseSink` that writes normalized records directly into KB. The Python endpoint plane already has SourceEndpoints and SinkEndpoints (Spark HDFS/Iceberg) that know how to talk to external systems. Without a unified contract, we risk:

- Duplicating endpoint logic in TS and Python.
- Confusion over where ingestion "really" lives.
- Difficulty introducing semantic sources (Jira/Confluence/OneDrive) and CDM sinks consistently.

We want a single ingestion data-plane model: **SourceEndpoint → Staging → SinkEndpoint**, with Python handling the data movement and TypeScript handling orchestration, state, and KB/metadata updates. 

## Interfaces / Contracts

### 1. Endpoint roles (recap)

- **SourceEndpoint** (Python; `runtime_common/endpoints/*`):
  - Defined via `DescribedEndpoint` + descriptor fields/capabilities. 
  - Capabilities (spec-level names):
    - `metadata.collect` (descriptor flag `metadata`).
    - `metadata.preview`.
    - `ingest.full` (current `supports_full`).
    - `ingest.incremental` (current `supports_incremental`).

- **SinkEndpoint** (Python; e.g. `hdfs.parquet`, `warehouse.iceberg`):
  - Responsible for writing records to persistent stores (HDFS, Iceberg, JDBC, CDM tables). :contentReference[oaicite:9]{index=9}
  - Capabilities (spec-level):
    - `sink.hdfs`, `sink.iceberg`, `sink.jdbc`, `sink.cdm`, etc.

- Endpoints are registered only in Python, and surfaced to TS via `MetadataEndpoint` rows and `metadataEndpointTemplates` GraphQL. 

### 2. Staging Provider contract

**Goal:** decouple SourceEndpoints from SinkEndpoints via an intermediate staging layer.

- **StagingProvider** (Python concept) encapsulates how data is buffered between source and sink:

  ```python
  class StagingProvider(Protocol):
      def allocate_session(self, context: IngestionContext) -> StagingSession: ...
  
  class StagingSession(Protocol):
      id: str
  
      def writer(self) -> RecordWriter: ...
      def reader(self) -> RecordReader: ...
      def close(self) -> None: ...
````

* **RecordWriter/RecordReader** are abstract helpers over concrete formats:

  * `RecordWriter.write_batch(batch: Iterable[Row])`
  * `RecordReader.iter_batches(chunk_size: int) -> Iterable[Iterable[Row]]`

* Initial implementation targets **in-memory / local-process** staging with a simple columnar or row-oriented format (e.g., Python objects or Arrow). Later, we can add Kafka/object storage implementations without changing the Source/Sink contracts.

* StagingProvider is configured per ingestion run (e.g., `in_memory` default), but the SourceEndpoint and SinkEndpoint only receive a `StagingSession` object.

### 3. Ingestion data-plane: Source → Staging → Sink

The core ingestion loop for a single unit is:

1. **Source phase** (Python):

   ```python
   def export_to_staging(
       source_endpoint: SourceEndpoint,
       unit_id: str,
       checkpoint: dict | None,
       policy: dict,
       staging: StagingSession,
   ) -> ExportResult:
       """
       Calls source_endpoint to read records (full or incremental),
       writes them to staging.writer(), and returns:
       - new_checkpoint: dict | None
       - stats: { "exported_rows": int, "duration_ms": int, ... }
       """
   ```

2. **Sink phase** (Python):

   ```python
   def import_from_staging(
       sink_endpoint: SinkEndpoint,
       unit_id: str,
       staging: StagingSession,
       policy: dict,
   ) -> ImportResult:
       """
       Reads records from staging.reader() and writes them via sink_endpoint
       into the target store (HDFS, warehouse, CDM tables, ...).
       Returns stats: { "applied_rows": int, "duration_ms": int, ... }.
       """
   ```

3. **Combined unit run**:

   ```python
   def run_ingestion_unit(
       source_endpoint_id: str,
       sink_endpoint_id: str | None,
       unit_id: str,
       checkpoint: dict | None,
       policy: dict,
       staging_provider_id: str,
   ) -> IngestionUnitResult:
       """
       - Resolves endpoints via registry.
       - Calls staging_provider.allocate_session().
       - Runs export_to_staging, then import_from_staging (if sink_endpoint_id not None).
       - Closes staging session.
       - Returns { new_checkpoint, stats, errors } for TS to persist.
       """
   ```

* For **KB/semantic flows**, `sink_endpoint_id` may be `None`. In that case, the Python worker may emit **normalized/CDM records** in small batches back to TS, or write enriched metadata directly to KB via an internal client. The staging abstraction remains, but the “sink” is an internal service rather than a sink endpoint.

### 4. Orchestration: TypeScript workflows

Ingestion-core v1 wiring is updated conceptually as follows:

* **GraphQL layer** (`apps/metadata-api/src/schema.ts`):

  * Unchanged queries/mutations:

    * `ingestionUnits(endpointId)`, `ingestionStatuses(endpointId)`, `ingestionStatus(endpointId, unitId)`.
    * `startIngestion`, `pauseIngestion`, `resetIngestionCheckpoint`.

* **Temporal workflow** (`ingestionRunWorkflow`):

  * Calls activities:

    * `startIngestionRun`:

      * Reads endpoint + unit config.
      * Loads checkpoint from KV.
      * Marks `IngestionUnitState` as `RUNNING`.
    * `runIngestionUnitPythonWorker` (new activity):

      * Passes `{ endpointId, unitId, checkpoint, policy, sinkEndpointId?, stagingProviderId }` to Python ingestion worker.
      * Receives `{ newCheckpoint, stats, errors }`.
    * `completeIngestionRun` / `failIngestionRun`:

      * Write checkpoint back to KV.
      * Update `IngestionUnitState` with stats and status.

* **TypeScript no longer models data-plane** via `IngestionDriver`/`IngestionSink` for production paths:

  * These types may remain as internal test helpers or be removed, but they are not the primary contract.
  * The canonical ingestion contract is Python endpoints + staging.

### 5. Metadata: KV, KB, and enrichment

* **KV store**:

  * Stores `{ endpointId, unitId }` → `{ cursor, lastRunId, stats, lastUpdatedAt }` for ingestion checkpoints and summary stats.

* **KB (GraphStore)**:

  * Stores **connected metadata**: endpoints, datasets, runs, semantic entities, and their relationships. 
  * Ingestion runs may emit “run completed” events or `NormalizedRecord` batches that TS uses to update KB via `graphStore` (Jira issues, doc pages, SLA signals, etc.).

* **SinkEndpoints**:

  * Persist **data records** (rows, files, CDM tables).
  * May also emit lightweight metadata (counts, durations, storage locations) captured by Python and forwarded to TS/KB, but the SinkEndpoint remains focused on data writes.

Summary:

* Data-plane: `SourceEndpoint → Staging (Provider) → SinkEndpoint`.
* Control-plane: TS workflows + KV + Prisma.
* Knowledge-plane: KB (GraphStore) enriched by metadata emitted from collections, ingestion, and signals.

## Data & State

* No immediate DB schema changes required.
* `IngestionUnitState` remains the primary durable record for ingestion run status and summary stats.
* KV remains the source of truth for checkpoints.
* Staging is ephemeral per unit run and must be cleaned up at the end of each session.

## Constraints

* GraphQL ingestion signatures must remain backward compatible.
* `ingestionRunWorkflow` behavior must remain semantically similar (start → sync → complete/fail), but its internal implementation calls Python instead of TS drivers.
* StagingProvider interface must be simple enough to support an in-memory first implementation, with clear extension points for Kafka/object storage later.

## Acceptance Mapping

* AC1 → The new docs/meta spec is created and describes Source–Staging–Sink and StagingProvider in terms of existing Python endpoints and Spark sinks.
* AC2 → INGESTION_AND_SINKS.md is updated to remove `IngestionDriver`/`IngestionSink` as the canonical layer and to reference the new Python ingestion worker and staging model.
* AC3 → `ingestionRunWorkflow` is updated (and tests adjusted) so that the main path uses a Python ingestion activity instead of a TS driver/sink pair.
* AC4 → The spec’s explanation of KV, KB, and SinkEndpoints is consistent with MAP.md, ENDPOINTS.md, and the updated INGESTION_AND_SINKS.md.

## Risks / Open Questions

* R1: The exact API between TypeScript and the Python ingestion worker (e.g., Temporal activities vs RPC vs CLI) is implementation detail and may need a follow-up slug.
* R2: Existing tests for ingestion-core v1 assume `StaticIngestionDriver` and `KnowledgeBaseSink`; they must be updated carefully to avoid regressions during refactor.
* Q1: For semantic ingestion (Jira/Confluence/OneDrive), how many normalized records can TS safely handle per run vs requiring a StagingProvider-based KB writer?

````

---

