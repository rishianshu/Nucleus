# Ingestion Source → Staging → Sink (v1)

This note records the canonical ingestion data-plane for Nucleus following the `ingestion-source-staging-sink-v1` slug. It ties the Unified Connector Layer (UCL, Go) to the Temporal/TypeScript control plane so future semantic sources (Jira/Confluence/OneDrive) and sinks can rely on a single contract.

## Roles & Single Endpoint Plane

| Layer | Responsibilities | Implementation |
|-------|------------------|----------------|
| **SourceEndpoint** | Connects to upstream systems (JDBC, HTTP, streams) and exports rows. Capabilities include `metadata.collect`, `metadata.preview`, `ingest.full`, `ingest.incremental`. | UCL connectors (Go) implementing a SourceEndpoint interface; exposed to Temporal as activities and to other services via gRPC. Templates and descriptors remain defined in Nucleus metadata and UCL config. |
| **StagingProvider** | Buffers exported rows between Source and Sink. Handles `writer()` / `reader()` lifecycles, TTL cleanup, and reuse across slices. | A staging abstraction that uses the ObjectStore as the primary backing store (buckets/keys); legacy Spark/HDFS staging directories remain available as a dev-only provider. |
| **SinkEndpoint** | Writes staged rows into external stores (HDFS, Iceberg, JDBC/CDM, other sinks). Emits provenance/state events but does **not** touch KB. | UCL connectors implementing SinkEndpoint semantics or dedicated CDM sinks (e.g. `cdm.jdbc`); invoked by the ingestion runtime using staging handles. |
| **TypeScript orchestration** | GraphQL, Temporal workflows, KV checkpoints, Prisma `IngestionUnitState`, KB updates, and calling UCL ingestion activities. | `apps/metadata-api/src/schema.ts`, `apps/metadata-api/src/temporal/{activities.ts,workflows.ts}`, `apps/metadata-api/src/ingestion/*`. |

All Source/Sink descriptors remain defined at the connector layer (UCL) and surfaced to Nucleus via endpoint templates. TypeScript reads their descriptors via `metadataEndpointTemplates` and stores user configs in Prisma (`prisma/metadata/schema.prisma – MetadataEndpoint`).

## Staging Provider Contract

Staging abstracts how records travel between endpoints. In pseudocode:

```ts
interface StagingProvider {
  allocateSession(context: IngestionContext): StagingSession;
}

interface StagingSession {
  id: string;

  writer(): RecordWriter;
  reader(): RecordReader;
  close(): void;
}

interface RecordWriter {
  writeBatch(batch: Iterable<Row>): Promise<void>;
}

interface RecordReader {
  iterBatches(chunkSize: number): AsyncIterable<Row[]>;
}

	•	RecordWriter.writeBatch(batch) streams rows from a SourceEndpoint into staging.
	•	RecordReader.iterBatches(chunkSize) streams rows from staging into SinkEndpoints (or special sinks such as CDM writers).
	•	The initial provider defaults to ObjectStore-backed staging (buckets/keys) with optional dev providers for in-memory or Spark/HDFS directories.

The only contract that the control plane cares about is that:
	•	Source writes into a StagingSession and returns a handle.
	•	Sink reads from that same session (or from an equivalent {bucket, key} handle) to consume data.

Data-Plane Lifecycle (per unit)
	1.	Export (Source → staging)
The ingestion runtime in UCL builds the SourceEndpoint using its endpoint/connector registry. It reads either full datasets or incremental slices (using any endpoint-specific planners/probers) and writes each slice via stagingSession.writer(). For each run it returns at least:

{
  newCheckpoint: any;   // JSON-serializable cursor
  stats: {
    rowsExported: number;
    slices: number;
    startedAt: string;
    completedAt: string;
  };
  stagingHandles?: Array<{ bucket: string; key: string; contentType?: string; metadata?: Record<string,string> }>;
}

	•	newCheckpoint is persisted via KvStore (namespaced by endpoint/unit/sink).
	•	stagingHandles are optional but recommended when using ObjectStore directly.

	2.	Import (staging → Sink)
SinkEndpoint instances consume rows via stagingSession.reader() or by reading the {bucket, key} handles produced by the export step, then persist them to their targets (raw files, warehouses, CDM tables, etc.). Sink endpoints may emit telemetry and provenance (run stats, table/partition info) but do not talk directly to KB.
	•	CDM sinks (e.g. cdm.jdbc) consume CDM-normalized rows and write them into managed tables.
	•	Raw sinks may write Parquet/JSON or other formats depending on configuration.
	3.	Cleanup
	•	The StagingSession closes (creating _SUCCESS / _LANDED markers or equivalent where applicable).
	•	TTL cleanup is handled via the staging provider (for example, periodic deletion of old objects under ingestion/<endpointId>/<runId>/).

UCL runtime entry point (conceptual):
	•	A UCL ingestion service or worker process registers the ingestion activities and implements the Source→Staging→Sink orchestration for each connector family. Temporal activities call into this service rather than embedding ingestion logic in TypeScript.

Store usage
	•	KvStore – DB-backed table (kv_entries) keyed by {namespace, scopeId, key} holds checkpoints and transient state. Namespaces include ingestion (endpoint/unit/sink), ucl, and signals. File-backed metadata/kv-store.json remains a dev fallback only; the database is the canonical store.
	•	ObjectStore – staging artifacts (slices, manifests, git/doc archives) stream to { bucket, key } addresses such as ingestion/<workspaceId>/<endpointId>/<runId>/<sliceIndex>. Temporal activities pass these references—not payloads—between TS workflows and the UCL runtime so large blobs avoid workflow payload limits.
	•	GraphStore / MetadataStore – remain the semantic stores for catalog/KB writes; ingestion only stores semantic summaries here, not raw data.

Control Plane (TypeScript)
	1.	GraphQL/Resolvers (apps/metadata-api/src/schema.ts)
Expose ingestionUnits, ingestionStatuses, ingestionSinks, startIngestion, etc. Mutations are unchanged at the API level—this slug only tightens the implementation behind the workflow.
	2.	Temporal Workflow (apps/metadata-api/src/temporal/workflows.ts)
ingestionRunWorkflow performs:
	•	startIngestionRun (TS activity) → loads checkpoint via the DB-backed KvStore interface (apps/metadata-api/src/ingestion/checkpoints.ts), marks Prisma IngestionUnitState, and resolves sink/staging defaults.
	•	Ingestion activities (for example, connectorActivities.runIngestionUnit) → hand { endpointId, unitId, checkpoint, sinkId?, stagingProviderId?, policy? } (plus any ObjectStore handles) to the UCL runtime, which invokes the Source→Staging→Sink logic for that connector and unit.
	•	completeIngestionRun / failIngestionRun (TS activities) → persist checkpoint + stats, update IngestionUnitState.
Temporal does not stream NormalizedRecord batches; bulk data stays in the UCL ingestion runtime and sinks behind the ObjectStore.
	3.	KB (GraphStore)
When ingestion needs to surface semantic metadata (e.g., Jira issues, doc entities), the UCL runtime and/or TS side emit summary stats or normalized metadata that TS converts into KB nodes/edges using graphStore.upsertEntity. This is orthogonal to data persistence in sinks.
	4.	KV
Checkpoints and operational stats live in the DB-backed KvStore interface (table kv_entries with (namespace, scope_id, key) primary key). Keys remain ingest::<vendor>::endpoint::<endpointId>::unit::<unitId>::sink::<sinkId?>; the file driver is only a compatibility fallback for local dev.

KB vs Sink vs KV
	•	KvStore (DB) → operational state (lastRunId, cursor, stats) via the shared interface; default driver points at kv_entries instead of the file store.
	•	ObjectStore → staging + large artifacts referenced by ingestion (slices, archives). Workflows exchange {bucket, key} handles instead of streaming payloads.
	•	KB (GraphStore) → connected metadata / knowledge (endpoints, datasets, semantic entities). Writes happen via graphStore.upsertEntity and the KB React console (apps/metadata-ui/src/knowledge-base/*).
	•	SinkEndpoints → actual data persistence (raw files, warehouses, CDM tables, other sinks). Implemented as UCL connectors or dedicated sink runtimes.

These concerns stay separate—TypeScript orchestrates them but data-plane work happens inside the UCL ingestion runtime and sinks.

Legacy Helpers

packages/metadata-core still exposes IngestionDriver / IngestionSink interfaces for tests and backwards compatibility, but they are now considered legacy helpers. Production ingestion flows must go through UCL connectors and the Source→Staging→Sink pipeline described here, not through the older in-process TS drivers.

If you want a variant that still explicitly mentions the old Python paths as “legacy implementation”, I can add a short “Legacy (Python) implementation” section at the bottom, but the version above is fully aligned with your current UCL + stores direction.