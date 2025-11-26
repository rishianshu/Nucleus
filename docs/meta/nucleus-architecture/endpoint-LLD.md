# Endpoint Architecture — Low Level Design

## Code Layout
| Layer | Location | Notes |
|-------|----------|-------|
| Descriptors & Endpoint classes | `platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*.py` | One module per family/vendor (e.g., `jira_http`, `jdbc_postgres`). |
| Endpoint registry | `runtime_common/endpoints/registry.py` | Aggregates descriptors for GraphQL + CLI. |
| Endpoint factory | `runtime_common/endpoints/factory.py` | Builds runtime Source/Sink endpoints given configs/tools. |
| Metadata adapters | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/adapters/*.py` | Wrap endpoints with `MetadataSubsystem` implementations. |
| Metadata normalizers | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/normalizers/*.py` | Convert raw manifests into `CatalogSnapshot`. |
| Temporal worker | `platform/spark-ingestion/temporal/metadata_worker.py` | Runs metadata/preview/ingestion activities; imports endpoint modules dynamically. |
| TS ingestion core | `apps/metadata-api/src/temporal/*.ts`, `apps/metadata-api/src/ingestion/*` | GraphQL schema, Temporal workflows, sink registries. |

## Descriptor Schema
```python
EndpointDescriptor(
    id="jira.http",
    family="HTTP",
    vendor="Atlassian",
    fields=(
        EndpointFieldDescriptor(key="base_url", value_type="URL", ...),
        EndpointFieldDescriptor(key="auth_type", value_type="ENUM", options=...),
        ...
    ),
    capabilities=(
        EndpointCapabilityDescriptor(key="metadata", label="Metadata harvesting"),
        EndpointCapabilityDescriptor(key="ingest.incremental", label="Incremental ingestion"),
    ),
    connection=EndpointConnectionTemplate(url_template="{base_url}"),
    probing=EndpointProbingPlan(...),
)
```
- `descriptor_fields()` describes UI form and validation rules (regex, dependencies, defaults, semantic hints).
- `descriptor_capabilities()` feed GraphQL/console badges.
- Additional metadata (docs URLs, default labels, sample config) helps autopopulate UI + CLI templates.

## Endpoint Implementation Checklist
1. **Constructor arguments**
   - `tool`: Execution tool (Spark/JDBC, HTTP session) used for runtime operations.
   - `endpoint_cfg`: Persisted endpoint config from Prisma.
   - `table_cfg`: Artifact-specific overrides (schema/table/unit info).
   - `metadata_access`: Optional `MetadataSubsystem`.
2. **Required methods**
   - `configure(table_cfg)` – merge overrides.
   - `capabilities()` – return `EndpointCapabilities`.
   - `describe()` – sanitized view for telemetry (no secrets).
   - Source endpoints implement `read_full`, `read_slice`, `count_between`, and should translate unit/slice inputs into the correct SQL/JQL/REST statements for the upstream system.
   - Sink endpoints implement `write_raw`, `finalize_full`, `stage_incremental_slice`, `commit_incremental`, `publish_dataset`, `latest_watermark`.
3. **Metadata subsystem wiring**
   - Attempt to import adapter lazily; fail gracefully when metadata_service not installed (unit tests).
   - Set `supports_metadata=True` in `EndpointCapabilities` only when subsystem available.

## Metadata Subsystem Pattern
```python
class FooMetadataSubsystem(MetadataSubsystem):
    def __init__(self, endpoint: FooEndpoint):
        self.endpoint = endpoint
        self._normalizer = FooMetadataNormalizer()

    def capabilities(self) -> Dict[str, Any]:
        return {"sections": ["environment", "schema_fields"], "datasets": ["foo.bar"]}

    def probe_environment(self, *, config):
        # query server for metadata, normalize dictionaries/custom fields
        return {"dialect": "foo", "version": "...", "catalog_sources": {...}}

    def collect_snapshot(self, *, config, environment):
        manifest = {...}  # static + dynamic schema, API catalog, value lists
        raw = {"datasource": ..., "dataset": manifest}
        return self._normalizer.normalize(raw=raw, environment=environment, config=config, endpoint_descriptor=self.endpoint.describe())
```
- Catalog sources store reusable dictionaries (custom fields, statuses, etc.).
- API catalogs describe REST/RPC coverage.
- Normalizers translate manifests into `CatalogSnapshot` objects.

## Units & Incremental Planning
- `EndpointUnitDescriptor` (`runtime_common.endpoints.base`) describes each logical unit exposed by a source. JDBC endpoints typically produce one unit per `{schema}.{table}`; semantic endpoints (Jira) can return multiple (projects/issues/users).
- `SupportsIngestionUnits.list_units(checkpoint, filters)` lets workflows request unit metadata and default policies (e.g., which cursor to use).
- `SupportsIncrementalPlanning.plan_incremental_slices(unit_id, checkpoint, limit)` returns a list of `IngestionSlice(lower, upper)` entries that the workflow can execute sequentially. JDBC implementations convert slices into SQL predicates; HTTP endpoints translate slices into JQL/REST params (e.g., `updated >= lower`).
- After each slice, the workflow can persist intermediate checkpoints (KV) so large syncs resume gracefully. Endpoints can also emit slice-level stats so workflows understand progress.

## Normalized Output Structures
| Model | Location | Purpose |
|-------|----------|---------|
| `CatalogSnapshot`, `DataSourceMetadata`, `DatasetMetadata`, `SchemaField`, `DatasetStatistics`, `DatasetConstraint` | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/models.py` | Canonical metadata schema emitted by normalizers and cached/persisted via Metadata Workspace. |
| `MetadataRecord` | `platform/spark-ingestion/packages/runtime-core/src/runtime_core/__init__.py` | Wrapper used by MetadataGateway/cache to store snapshots with producer metadata. |
| `NormalizedRecord` | `packages/metadata-core/src/index.ts` | Canonical ingestion payload consumed by sinks (e.g., KnowledgeBaseSink); includes logical IDs, scope, payload, and edges. |

- Normalizers must populate the `CatalogSnapshot.dataset`, `.schema_fields`, `.statistics`, etc. even if some sections are empty, so GraphQL resolvers/UI can rely on stable shapes.
- Ingestion activities should only emit `NormalizedRecord[]`; sinks are responsible for translating those into KB nodes, CDM rows, or other storage backends.
- Any connector-specific attributes belong in the `properties`/`extras` maps of these models, keeping the primary fields interoperable.

## Ingestion Workflow Integration
1. GraphQL `startIngestion` resolves endpoint + sink IDs and seeds Temporal workflow.
2. `ingestionRunWorkflow` (TS) kicks off Python activity `runIngestionUnit`.
3. Python worker resolves endpoint + unit policy, runs Source→Staging logic, returns `{ newCheckpoint, stats, records? }`.
4. TS workflow persists checkpoint/state and streams normalized records into KB sink (or other sinks).
5. Prisma `IngestionUnitState` provides GraphQL/API state; UI polls via `ingestionUnits`/`ingestionRuns`.

## Testing Strategy
- **Descriptor tests**: ensure fields/capabilities render (e.g., GraphQL query for templates).
- **Metadata subsystem tests**:
  - Mock HTTP/database responses for `probe_environment`.
  - Snapshot manifests to catch schema changes.
- **Ingestion tests**:
  - Python unit tests for helper functions (pagination, normalization).
  - Temporal activity tests (TS) verifying checkpoints/stats path.
  - Playwright flows covering UI actions (register endpoint, run ingestion, view KB output).

## Extending to New Endpoints
1. Duplicate the descriptor+adapter pattern with new `DATASET_DEFINITIONS` and API mapping (review Jira example in `metadata_service.adapters.jira`).
2. For JDBC-style sources reuse `OracleMetadataSubsystem`/`PostgresMetadataSubsystem` as references (SQL probes, schema queries, guardrails).
3. For HTTP/semantic sources adopt the **dynamic schema** + **API catalog** approach so agents/UI know what endpoints exist without reading source-specific docs.
4. Update `docs/meta/nucleus-architecture/ENDPOINTS.md` table and add connector-specific appendix if needed.
