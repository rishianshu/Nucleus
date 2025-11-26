# Endpoint Architecture — High Level Design

## Goals
- Provide a single reference for building **any** Source/Sink endpoint so new connectors follow the same descriptor, metadata, and ingestion patterns.
- Decouple connector-specific docs (e.g., Jira, Postgres) from the reusable framework: `DescribedEndpoint`, metadata subsystems, ingestion drivers/sinks.
- Make it easy for product engineers and external contributors to add endpoints by following consistent steps (descriptor → metadata subsystem → ingestion integration → docs/tests).

## Core Concepts
1. **Endpoint Descriptor (`DescribedEndpoint`)**
   - Lives under `runtime_common/endpoints/<family>_<vendor>.py`.
   - Declares:
     - Metadata (`EndpointDescriptor`): `id`, `family`, `vendor`, docs URL, categories, labels.
     - `descriptor_fields()`: configuration schema (types, dependencies, defaults, sensitivity).
     - `descriptor_capabilities()`: features (metadata, preview, ingest.full/incremental, semantic).
     - Optional `connection`/`probing` templates for auto-generated tests.
      - `extras`: arbitrary JSON surfaced to GraphQL/UI (e.g., Jira publishes its REST API catalog so users can inspect which endpoints are exercised).
   - Used by GraphQL (`metadataEndpointTemplates`) and the Metadata Console for registration.

2. **Endpoint Implementations**
   - Implement `SourceEndpoint`, `SinkEndpoint`, or `DataEndpoint`.
   - Provide `capabilities()`, `describe()`, and data-plane methods (e.g., `read_full`, `stage_incremental_slice`).
   - For HTTP/semantic sources, SourceEndpoint may delegate runtime I/O to helper functions rather than Spark.

3. **Metadata Subsystem (optional but recommended)**
   - Implemented in `metadata_service.adapters.*`.
   - Contract (`MetadataSubsystem`):
     - `capabilities()`: list of supported sections (environment/schema/stats/etc.).
     - `probe_environment(config)`: gather server/version/context data.
     - `collect_snapshot(config, environment)`: produce dataset manifests, handing raw payloads off to the normalizer.
   - Normalizers in `metadata_service.normalizers.*` map manifests to `CatalogSnapshot`.
   - Subsystem gets attached to the endpoint (e.g., `self.metadata_access = JiraMetadataSubsystem(self)`), enabling Metadata Workspace → Temporal collection runs.

4. **Unit-Oriented Ingestion**
   - Every source is modeled as a set of **units** (datasets/collections) surfaced through the optional `SupportsIngestionUnits` contract.
   - `EndpointUnitDescriptor` captures unitId/kind/display name plus policies (incremental cursors, default filters).
   - Workflows request units, and endpoints interpret checkpoint/filter inputs to produce the correct SQL/JQL/REST queries for that unit.
   - **Metadata-first requirement:** units must map directly to the datasets emitted by the metadata subsystem. If a dataset does not exist in the catalog, it cannot expose an ingestion unit. This keeps ingestion policies aligned with what the Metadata Workspace knows about the source.

5. **Adaptive Planning & Intermediate Updates**
   - Endpoints may implement `SupportsIncrementalPlanning` to produce `IngestionSlice` plans (time windows, pagination offsets) based on checkpoints and target batch sizes.
   - Workflows iterate over slices, persisting intermediate checkpoints after each slice so large syncs can resume. This keeps adaptive planning near the data plane while Temporal/KV focus on orchestration.
   - For high-volume HTTP sources (e.g., Jira), the endpoint helper owns pagination/JQL construction and emits batches of `NormalizedRecord` objects per slice; JDBC endpoints build SQL ranges (`WHERE incr > lower AND incr <= upper`).

6. **Ingestion Integration**
   - TypeScript ingestion core uses endpoint metadata to determine available units; Temporal workflow triggers Python runtime helpers/activity code (e.g., `run_jira_ingestion_unit`).
   - Source endpoints feed data into staging providers or return normalized records; sinks (TS plane) persist to KB, Lakehouse, etc.
   - Checkpoints and stats stored via `IngestionUnitState` + KV store.

7. **API Surface Metadata (Semantic/HTTP sources)**
   - Capture REST/RPC endpoints, scopes, docs references, and sample payload metadata so humans + agents understand how ingestion fetches data.
   - Represented as dataset properties (`apiEndpoints`) or dedicated catalogs (e.g., `jira.api_surface`), allowing UI/Docs to reflect integration breadth.

8. **Normalized Data Models (metadata + ingestion)**
   - Metadata subsystems **always** emit `CatalogSnapshot` structures defined in `metadata_service.models`. The core pieces are:
     - `DataSourceMetadata` – identifies the upstream system (id/name/system/version/properties).
     - `DatasetMetadata` – describes the logical entity (name/type/location/properties/tags).
     - `SchemaField`/`SchemaFieldStatistics` – column-level definitions and profiling stats.
     - `DatasetStatistics` and `DatasetConstraint` – table-level stats & constraints.
   - Normalizers convert vendor-specific payloads into these models so downstream services (metadata cache, GraphQL, KB) speak a consistent language regardless of source.
   - Ingestion subsystems operate on `NormalizedRecord` objects (`packages/metadata-core`) that describe KB/semantic entities (`entityType`, `logicalId`, `scope`, `payload`, `edges`). Drivers return batches of these records, and sinks (e.g., `KnowledgeBaseSink`) apply them uniformly.
   - By funneling both catalog metadata and ingestion data through these canonical models, the system stays balanced: endpoints expose vendor details, but the rest of the platform (GraphQL, UI, agents) interacts only with normalized structures. Remember that KB persists semantic knowledge, not raw data; ingested rows continue to live in the configured sinks and will be surfaced by dedicated data views.

## Workflow for New Endpoints
1. **Plan & Spec**
   - Define scope (source data, datasets, ingestion units, sinks).
   - Identify config requirements, auth flows, rate limits, and supported operations (metadata vs. ingestion vs. preview).
2. **Implement Descriptor & Endpoint**
   - Add new module under `runtime_common/endpoints`.
   - Provide descriptor metadata/fields/capabilities.
   - Implement `SourceEndpoint`/`SinkEndpoint` methods and register with `EndpointFactory`/`REGISTRY`.
3. **Add Metadata Subsystem (if applicable)**
   - Create adapter in `metadata_service.adapters`.
   - Implement environment probing, dataset manifests, API catalogs, and reuse/extend normalizers.
   - Export adapter via `metadata_service.adapters.__init__`.
   - The subsystem is the canonical place to describe datasets; ingestion units later reuse these manifests. Run collection at least once in dev/tests before enabling ingestion so catalog state exists.
4. **Wire Ingestion**
   - Extend ingestion registry (TS) if new driver/sink combos needed.
   - Implement Python worker helpers to fetch data (Source → Staging → Sink), returning normalized records/batches and leveraging the endpoint’s unit/slice planning.
   - Update GraphQL resolvers/UI to surface ingestion units and statuses.
   - Ensure ingestion units reference the dataset IDs produced by the metadata subsystem, and record run stats/checkpoints so dataset detail panes can show ingestion history.
5. **Document + Test**
   - Update `docs/meta/nucleus-architecture/ENDPOINTS.md` table (new row with links).
   - Provide connector-specific notes/HLD/LLD if needed, referencing this core doc.
   - Add unit/integration tests (metadata subsystem, ingestion pipelines) + Playwright coverage for UI flows.

## Reuse & Extensibility
- **Field descriptors** share semantics (value types, dependencies). Use helper constants for repeated patterns (e.g., auth blocks).
- **Dynamic schema discovery** (custom fields, dictionaries) should emit normalized catalogs so the UI/KB can evolve without code changes.
- **API catalog metadata** is optional but recommended for HTTP endpoints to capture coverage and ease future automation.
- **Testing strategy**: provide mock clients or fixtures per endpoint; use the common Temporal worker harness for ingestion tests.
