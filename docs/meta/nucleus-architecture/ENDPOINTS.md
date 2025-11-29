# Endpoint Families & Capabilities

The runtime endpoint abstractions live under `platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints`. Each `DescribedEndpoint` exposes:

- `descriptor()` → `EndpointDescriptor` (id/family/vendor/categories, field descriptors, capability descriptors, connection template).
- `descriptor_fields()` and `descriptor_capabilities()` used by the console to render config forms.
- Optional metadata subsystems (via `metadata_service.adapters.*`) when `supports_metadata` is enabled.

Endpoint descriptors are collected by `runtime_common/endpoints/registry.py` and exposed to the UI through `metadataEndpointTemplates` (GraphQL) → `MetadataWorkspace` (`apps/metadata-ui/src/metadata/MetadataWorkspace.tsx`).

## Design References

- **Core guidance**: see `docs/meta/nucleus-architecture/endpoint-HLD.md` (high-level workflow) and `endpoint-LLD.md` (implementation checklist). These documents describe how any new endpoint should be authored (descriptor → metadata subsystem → ingestion wiring) so connector-specific docs can stay lightweight.
- **Unit planning**: Source endpoints are encouraged to implement `SupportsIngestionUnits` / `SupportsIncrementalPlanning` so ingestion workflows can enumerate datasets and request adaptive slices rather than re-deriving SQL/JQL in the orchestrator.
- **Connector appendices**: per-endpoint HLD/LLD (e.g., `jira-metadata-HLD.md`) capture nuances without re-stating the core architecture.

## Registered Source Endpoints

| Template ID | Family / Vendor | Location | Capabilities (descriptor) | Metadata subsystem / normalizer | Notes |
|-------------|-----------------|----------|----------------------------|----------------------------------|-------|
| `jira.http` | HTTP / Atlassian Jira | `runtime_common/endpoints/jira_http.py` | `ingest.incremental`, `ingest.full`, implicit `metadata` (semantic catalogs) | `metadata_service.adapters.JiraMetadataSubsystem` + `metadata_service/normalizers/jira.py` (dynamic dataset + API inventory) | Descriptor collects base URL/auth/project filters; subsystem discovers custom fields, issue types/statuses/priorities, and embeds REST API metadata so ingestion + KB share a single schema.|
| `http.confluence` | HTTP / Atlassian Confluence | `runtime_common/endpoints/confluence_http.py` | `metadata`, `preview` | `metadata_service.adapters.ConfluenceMetadataSubsystem` + `metadata_service/normalizers/confluence.py` | Collects spaces/pages/attachments via Confluence REST v1/v2, surfaces doc CDM bindings, and powers catalog previews by fetching rendered page storage payloads. |
| `jdbc.postgres` | JDBC / Postgres | `runtime_common/endpoints/jdbc_postgres.py` | `metadata` (catalog harvest), inherits `preview`/`count_probe`/incremental flags from `JdbcEndpoint`. | `metadata_service.adapters.PostgresMetadataSubsystem`, normalizers in `metadata_service/normalizers/postgres.py`. | Adds SSL/role fields, Postgres probing methods, enables `supports_metadata=True`. |
| `jdbc.oracle` | JDBC / Oracle | `runtime_common/endpoints/jdbc_oracle.py` | `metadata`, `preview`, Oracle-specific guardrails. | `metadata_service.adapters.OracleMetadataSubsystem`, normalizers `metadata_service/normalizers/oracle.py`. | Handles case-sensitive identifiers, partitioning, NUMBER guardrails. |
| `jdbc.mssql` | JDBC / Microsoft SQL Server | `runtime_common/endpoints/jdbc_mssql.py` | `metadata`, `preview`, incremental. | Reuses SQL Server normalizer via metadata adapters (within metadata service). | Adds Windows auth + availability group options. |
| `jdbc.generic` (`jdbc.*`) | JDBC / Generic | `runtime_common/endpoints/jdbc.py` | baseline `metadata` (disabled until subclass sets subsystem), `preview`, `supports_full` + optional incremental. | None by default; subclass must attach `metadata_access`. | Acts as fallback when vendor-specific version missing; still exposes descriptor fields for host/db/credentials. |
| `http.rest` | HTTP / Generic API | `runtime_common/endpoints/http_rest.py` | `metadata` (schema introspection), `preview` (sample calls). | No metadata subsystem; relies on custom API responses. | Descriptor fields cover base URL, HTTP method, auth modes, pagination hints. |
| `stream.kafka` | Streaming / Kafka | `runtime_common/endpoints/stream_kafka.py` | `metadata` (topic description), `preview` (sample). | Stream metadata handled via runtime-common stream helpers. | Connects to Kafka brokers; emits topic/partition details. |

### CDM-aware ingestion units

Source endpoints that expose ingestion units should populate the optional `cdm_model_id` so downstream sinks know which CDM table(s) a unit feeds. Jira (`jira.http`) already ships `cdm.work.project`, `cdm.work.item`, `cdm.work.user`, `cdm.work.comment`, and `cdm.work.worklog` bindings; see `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md` for the canonical schemas and ID formats. Future connectors should follow the same pattern: define a mapping helper, tag each unit, and document the relationship so orchestrators/UI can present CDM-aware choices.

## Sink Endpoints (Spark ingestion plane)

| Template | Family / Target | Location | Capabilities | Notes |
|----------|-----------------|----------|--------------|-------|
| `hdfs.parquet` | SinkEndpoint / HDFS | `runtime_common/endpoints/hdfs/parquet.py` | `supports_write`, `supports_finalize`, `supports_publish`, `supports_watermark`, `supports_merge`, `supports_staging`. | Ships rows to RAW/HDFS, registers Hive tables via `HiveHelper`, manages incremental slices. |
| `warehouse.iceberg` (via `hdfs/warehouse.py`) | SinkEndpoint / Iceberg | `runtime_common/endpoints/hdfs/warehouse.py` | Merge/publish + Iceberg-specific helpers. | Wraps Parquet writes and optionally commits to Iceberg tables. |

These sink endpoints are consumed by Spark-based ingestion (not the new TypeScript ingestion-core).

## Descriptor Field Flow

1. **Server side**: `collect_endpoint_descriptors()` (registry) gathers `EndpointDescriptor` objects at API startup (`metadata_service` and `apps/metadata-api` reuse the registry).
2. **GraphQL**: `metadataEndpointTemplates` query (`apps/metadata-api/src/schema.ts`) resolves descriptors into types consumed by the console.
3. **Console**: `MetadataWorkspace` (`apps/metadata-ui/src/metadata/MetadataWorkspace.tsx`) renders descriptor fields, enforces validation, and serializes config values into `registerEndpoint` mutations. Fields include semantic hints (e.g., `FILE_PATH`, `PASSWORD`, `ENUM`), dependencies (`visible_when`), regexes, defaults—straight from descriptor definitions.
4. **Persistence**: Endpoint config stored in Prisma (`MetadataEndpoint.config` JSON column). Capabilities list persisted alongside, powering UI badges and GraphQL filtering.

## Capabilities Cheatsheet

- `metadata` – Endpoint can run catalog collectors via metadata-service adapters.
- `preview` – Supports sample queries for dataset previews (`previewMetadataDataset` GraphQL).
- `ingest.full` / `supports_full` – Exposed through `EndpointCapabilities` (JDBC endpoints default true).
- `supports_incremental` – True when incremental column configured; drives guardrails and UI hints.
- Semantic flags (`semantic:*`, `index:*`) are only present in specs (e.g., Jira/Confluence intent) and **not implemented yet**.

## Verifying Confluence metadata end-to-end (local harness)

For day-to-day QA it’s handy to kick off a Confluence collection outside the UI. The repo ships a tiny harness script that talks to the metadata GraphQL API, triggers a collection run, polls Temporal until it finishes, and then writes the resulting run metadata + catalog snapshot under `.artifacts/confluence-<timestamp>/`.

```
# 1) ensure the metadata stack + workers are running (pnpm metadata:workers:start)
# 2) grab a Keycloak token (or export METADATA_AUTH_TOKEN yourself)
METADATA_AUTH_TOKEN=$(cat /tmp/metadata_token.txt) \
METADATA_CONFLUENCE_ENDPOINT_ID=<endpoint-id> \
pnpm metadata:confluence:collect
```

If `METADATA_CONFLUENCE_ENDPOINT_ID` is omitted the harness will look for the first registered endpoint whose config contains `templateId: "http.confluence"`. The script accepts all of the usual metadata auth/env vars (it honours `METADATA_GRAPHQL_ENDPOINT` and the new `METADATA_AUTH_CLOCK_SKEW_SECONDS` override), so it works against both local and remote stacks. Artifacts are intentionally JSON so they can be attached to PRs or acceptance evidence without screenshots.
