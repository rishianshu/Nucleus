# Ingestion & Sink Architecture

This file complements `docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md`, which captures the canonical Source → Staging → Sink data-plane. The summary below focuses on how the TypeScript control plane orchestrates ingestion via the Unified Connector Layer (UCL, Go) and the staging/sink stores.

## Canonical Data-Plane (recap)

- Source/Sink connectors live in the Unified Connector Layer (UCL, Go) and are exposed to Temporal as activities and to other services via gRPC or equivalent APIs.
- Staging buffers slices between connectors and should persist slice payloads to the ObjectStore interface (bucket/key) for portability; legacy Spark staging dirs remain a compatible provider for dev.
- Sink endpoints persist rows to external systems (HDFS, Iceberg, JDBC/CDM).
- The TypeScript side **does not** implement a second endpoint registry. Instead, it orchestrates runs and updates KV/Prisma/KB.

See the dedicated Source–Staging–Sink spec for diagrams and code pointers. Endpoints now expose logical units (`EndpointUnitDescriptor`) and optional incremental planning helpers (`SupportsIncrementalPlanning`) so the worker/runtime can request slices directly from the source rather than re-implementing planning inside workflows.

## Control-Plane (TypeScript)

1. **GraphQL layer** (`apps/metadata-api/src/schema.ts`):
   - Queries: `ingestionUnits`, `ingestionStatuses`, `ingestionStatus`.
   - Mutations: `startIngestion`, `pauseIngestion`, `resetIngestionCheckpoint`.
   - Resolvers read endpoint configs, manage Prisma `IngestionUnitState`, and enqueue `ingestionRunWorkflow`.

2. **Temporal workflow** (`apps/metadata-api/src/temporal/workflows.ts`):
   - `startIngestionRun` (TS activity) → loads KvStore checkpoint from the DB-backed `kv_entries` table via the shared interface (`apps/metadata-api/src/ingestion/checkpoints.ts`), marks Prisma state, resolves sink/staging defaults.
   - Ingestion activities (for example, `connectorActivities.runIngestionUnit`) hand `{ endpointId, unitId, sinkId?, stagingProviderId?, checkpoint, policy }` to the UCL runtime, which invokes the Source→Staging→Sink logic for that connector. Connectors can call `list_units` / `plan_incremental_slices` on the endpoint to break the run into adaptive slices and publish intermediate updates. Large slices stream to ObjectStore and are referenced by `{bucket, key}` handles rather than embedding payloads in workflow inputs/outputs.
   - `completeIngestionRun` / `failIngestionRun` (TS activities) → write checkpoint back to KV, update `IngestionUnitState`, persist run stats.
   - TypeScript no longer streams `NormalizedBatch` payloads; bulk data stays in the connector runtime and sinks behind the ObjectStore.

3. **UI** (`apps/metadata-ui/src/ingestion/IngestionConsole.tsx`):
   - Lists endpoints/units using GraphQL.
   - Triggers mutations with ADR-compliant feedback (toast + inline cues).
   - Shows status info sourced from Prisma + KV stats.

4. **Metadata planner**:
   - Centralized helper that inspects endpoint config/capabilities and returns planned `MetadataJob`s.
   - Metadata subsystems expose optional hooks (`validate_metadata_config`, `plan_metadata_jobs`) so the planner delegates source-specific logic (Jira HTTP, JDBC, etc.) without hard-coded branches.
   - The connector runtime simply calls `plan_metadata_jobs(request, logger)` instead of branching on template ids inside the control plane.

## Metadata-first contract

Ingestion is grounded in the metadata catalog. Before a unit can appear in the console or be enqueued via GraphQL:

- The endpoint must be registered (descriptor + config stored via `MetadataEndpoint`).
- The metadata subsystem must have produced catalog datasets for that endpoint (`CatalogSnapshot` emitted via `collectCatalogSnapshots`). Only datasets that exist in `catalog.dataset` may expose ingestion units.
- `listUnits` implementations must simply reflect the dataset catalog; if the catalog is empty (e.g., collection never ran) the API returns no units and the UI shows the empty state.

This ensures orchestration never targets phantom datasets and keeps ingestion policies in sync with what the metadata workspace knows about the source.

### CDM bindings

`EndpointUnitDescriptor` now includes an optional `cdm_model_id` (surfaced to GraphQL/console as `cdmModelId`). When a source knows how to map its normalized records into one of the CDM families—work (`docs/meta/nucleus-architecture/CDM-WORK-MODEL.md`) or docs (`docs/meta/nucleus-architecture/CDM-DOCS-MODEL.md`)—it should tag each unit accordingly. Jira HTTP already advertises `cdm.work.*`, and the new Confluence/OneDrive subsystems advertise `cdm.doc.space`, `cdm.doc.item`, `cdm.doc.revision`, and `cdm.doc.link`. Units without a CDM mapping leave the field `null`, signalling that only KB enrichment (or a bespoke sink) is available.

When a unit advertises `cdm_model_id`, ingestion configs now expose a **data mode** selector:

- `raw` (default) keeps the existing source-shaped payloads.
- `cdm` instructs the connector runtime to apply the appropriate mapper (e.g., Jira→CDM work, Confluence→CDM docs) before emitting rows.

Because CDM rows typically land in downstream data stores rather than the KB, sinks also declare their CDM support. Sink registrations call `registerIngestionSink(id, factory, { supportedCdmModels: [...] })`, and the GraphQL API exposes these descriptors via the `ingestionSinks` query so the UI can filter/validate selections. When a user chooses `mode="cdm"`, the server enforces that:

1. the source unit has `cdm_model_id`,
2. the chosen sink’s `supportedCdmModels` includes that model (exact match or prefix wildcard like `cdm.work.*`), and
3. a **CDM sink endpoint** (e.g., the built-in `cdm.jdbc` template) is selected so the data plane knows where to land the rows.

> **Autoprovisioning CDM sinks**
>
> CDM sinks are modeled as metadata endpoints. The `cdm.jdbc` template captures the Postgres connection string, schema, and table prefix; admins then call the new `provisionCdmSink` GraphQL mutation to:
>
> 1. verify the sink can handle the requested `cdm_model_id`,
> 2. run idempotent DDL (`CREATE SCHEMA/TABLE IF NOT EXISTS … PRIMARY KEY (cdm_id)`), and
> 3. upsert a `catalog.dataset` record for the CDM table (labels include `sink-endpoint:<id>` and `cdm_model:<id>`).
>
> Provisioning is explicit in v1—configs must reference an already-provisioned sink endpoint to enable CDM mode. Future work can auto-trigger provisioning when toggling CDM mode or expose richer UI hints.

> **CDM sink write path**
>
> Temporal now forwards `sinkEndpointId`, `dataMode`, and `cdmModelId` to both the connector runtime and the sink. The runtime applies the relevant mapper (Jira→work CDM, Confluence/OneDrive→docs CDM, etc.) and emits normalized CDM records; the `cdm` sink writes them into the provisioned Postgres tables using parameterized upserts (`INSERT … ON CONFLICT (cdm_id) DO UPDATE`). Raw-mode runs continue to target the Knowledge Base sink unchanged.

> **Local dev fallback**
>
> When experimenting locally (or in automated tests) without a registered CDM sink endpoint, the metadata API can fall back to `CDM_WORK_DATABASE_URL` (or `METADATA_DATABASE_URL`) plus optional `CDM_WORK_DATABASE_SCHEMA` / `CDM_WORK_DATABASE_TABLE_PREFIX` env vars. This currently powers the CDM Work explorer and can also surface docs CDM tables while we wire official doc sinks. Production environments should continue to register explicit `cdm.jdbc` endpoints.

The Temporal workflow receives both the run-mode (full/incremental) and data-mode; Jira ingestion now produces CDM records (updating `entityType` and payload) only when the config requests it, keeping the raw path unchanged for other sinks.

## Connector runtime (UCL) highlights

- The UCL ingestion runtime registers Temporal activities (for example, `collectCatalogSnapshots`, `previewDataset`, `runIngestionUnit`) or equivalent handlers, depending on deployment.
- `runIngestionUnit` is responsible for invoking the ingestion runtime with the correct Source/Sink descriptors and staging provider, following the Source→Staging→Sink contract.
- Future semantic sources plug into UCL by implementing Source/Sink connectors plus table/unit configs; staging and sink wiring stays inside the connector runtime, not the TypeScript control plane.

### ObjectStore staging handles

- SourceEndpoints stream slices or archives into ObjectStore buckets/prefixes (e.g., `ingestion/<endpointId>/<runId>/<sliceIndex>`), returning `{bucket, key, contentType?, metadata?}` handles.
- Staging providers may wrap ObjectStore (S3/MinIO) or the existing Spark/HDFS directories; the contract is to pass handles to sinks and Temporal activities rather than copying payloads through workflow arguments.
- UCL (Go) connectors can reuse the same bucket/key contract for Git fetches or other large artifacts so the control plane remains language-agnostic.

## Legacy TypeScript Helpers

`packages/metadata-core/src/index.ts` still exports `IngestionDriver` / `IngestionSink` interfaces plus `KnowledgeBaseSink` utilities. They remain useful for local tests and KB-only experiments but are no longer the production contract. Documentation and workflows now treat them as **legacy helpers**.

## Current Sink Targets

| Sink | Implementation | Notes |
|------|----------------|-------|
| HDFS / RAW | `runtime_common/endpoints/hdfs/parquet.py` | Spark ingestion runtime default; writes raw files and publishes Hive tables. |
| Iceberg / warehouse | `runtime_common/endpoints/hdfs/warehouse.py` | Extends Parquet sink with Iceberg finalize/merge helpers. |
| KB enrichment | `KnowledgeBaseSink` (`apps/metadata-api/src/ingestion/kbSink.ts`) | Optional TS helper for emitting metadata into GraphStore when the connector runtime returns normalized entities. |

## State & Persistence

- **KvStore** – checkpoint + run stats stored in the DB-backed `kv_entries` table via the shared interface (`INGESTION_KV_DRIVER=db`); file-backed `metadata/kv-store.json` is dev-only fallback.
- **ObjectStore** – staging + large artifacts written/read via `{bucket, key}` handles (S3/MinIO default, local filesystem dev fallback).
- **Prisma** – `IngestionUnitState` rows track state, last run IDs, timestamps.
- **KB** – Graph metadata for console explorers (`apps/metadata-api/src/schema.ts` KB queries).

### Jira filters & metadata-driven selectors

Jira ingestion configs now include an optional `filter` payload that the GraphQL schema exposes as `JiraIngestionFilter`. It is Jira-only (other endpoints ignore the field) and contains structured selectors sourced from the catalog datasets:

| Field | Source | Purpose |
| ----- | ------ | ------- |
| `projectKeys` | `jira.projects` dataset | Restrict ingestion to specific projects. |
| `statuses` | `jira.statuses` dataset | Only include issues in these workflow states. |
| `assigneeIds` | `jira.users` dataset | Filter issues assigned to a set of Jira account IDs. |
| `updatedFrom` | Operator input | Bootstrap timestamp for new projects/dimensions. |

`jiraIngestionFilterOptions(endpointId)` returns the live options (projects/users/statuses) for the UI to render multiselect controls without hardcoding strings. The ingestion console writes the filter back through `configureIngestionUnit`; GraphQL enforces that filters can only be set on Jira units before persisting them in Prisma.

### Transient state for per-dimension cursors

Incremental runs now persist two KV artifacts per `{endpointId, unitId, sinkId}`:

1. **Checkpoint** – legacy cursor blob (unchanged) holding the runtime’s last checkpoint object.
2. **Transient state** – new JSON payload managed by `apps/metadata-api/src/ingestion/transientState.ts`.

Temporal’s `startIngestionRun` loads both and hands them—along with the filter config—to the connector runtime. Jira’s runtime records per-project watermarks in the transient state (`projects.<KEY>.lastUpdated`), so adding a new project to the filter only replays that project from `filter.updatedFrom` while existing projects continue from their saved cursor. The runtime returns the updated transient payload; the `completeIngestionRun` activity writes it back to KV with optimistic concurrency, logging but ignoring conflicts.

This pattern generalizes to any source that needs richer incremental metadata than a single cursor (e.g., per-dimension checkpoints, pagination tokens). Future endpoints can import the same transient state helpers without touching Prisma schema or Temporal signatures.

## KB scope vs. data views

The Knowledge Base stores semantic entities (projects, issues, users, lineage edges). It is *not* the final repository for bulk ingested data. When an ingestion unit publishes KB nodes, that is purely for context/reasoning, not for row-level storage. The underlying Source→Staging→Sink pipeline continues to land data in the configured sink (lakehouse, CDM, etc.). A future UI will expose that ingested data; in the meantime dataset detail panes can display ingestion stats/checkpoints to tie catalog entries to ingestion runs.

## Preview workflow

- `catalogDatasetPreview` returns the cached sample rows (from catalog metadata) so the UI can hydrate previews instantly without touching the upstream system.
- `previewMetadataDataset` looks up the catalog record + endpoint config, enforces the `preview` capability, and passes the request to Temporal for an on-demand live sample.
- To avoid changing activity signatures, HTTP/semantic endpoints encode their template id + parameters + dataset metadata as JSON inside the `connectionUrl` field. JDBC endpoints continue to send the raw JDBC URL.
- The connector runtime decodes the JSON payload (if present) and delegates to the endpoint’s metadata subsystem `preview_dataset` helper. Otherwise it falls back to the JDBC or family-specific preview path.
- Jira’s metadata subsystem implements `preview_dataset`, reusing the `_sync_jira_*` helpers to return small batches of normalized payloads.

## Remaining Gaps

- **Connector ingestion runtime** still needs full integration with Source→Staging→Sink flow per unit (current activity is a thin shim; future slugs will wire specific vendors end-to-end).
- **Semantic drivers** (Jira/Confluence/OneDrive) may still need deeper alignment with the unified planning + staging + CDM story; TypeScript orchestration is ready once connectors expose units consistently.
- **Non-KB sinks** accessible from TypeScript (e.g., CDM/JDBC connectors) will arrive once SinkEndpoints expose metadata to orchestration and UCL connectors implement the corresponding write paths.