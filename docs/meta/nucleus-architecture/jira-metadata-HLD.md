# Jira Metadata Subsystem — High Level Design

## Context & Goals
- Provide a first-class metadata subsystem for Jira endpoints so Metadata Workspace + ingestion pipelines share a single view of Jira's schema, semantics, and API surface.
- Surface **dynamic attributes** (built-in & custom fields) rather than relying on hardcoded field lists so downstream catalog/Kb experiences remain accurate as tenants customize Jira.
- Capture the **API contract** (HTTP methods, paths, docs) alongside dataset metadata so human operators and autonomous agents can reason about source capabilities without re-reading Atlassian docs.
- Extend the semantic coverage beyond issues/projects/users to include Jira's governing dictionaries (issue types, statuses, priorities) and the REST inventory that powers ingestion.

## High-Level Architecture
1. **JiraEndpoint (Python SourceEndpoint)**
   - Provides descriptor + connection plumbing.
   - When `metadata_service` is available it instantiates `JiraMetadataSubsystem`.
2. **JiraMetadataSubsystem (new adapter)**
   - Implements `MetadataSubsystem` contract.
   - `probe_environment()` calls Jira REST APIs (`serverInfo`, `myself`, fields, statuses, priorities, issue types) and returns a structured environment payload that includes:
     - Basic deployment info (version, deployment type, authenticated user).
     - `catalog_sources`: normalized copies of Jira dictionaries (issue fields, statuses, priorities, issue types).
     - `api_catalog`: a materialized map of REST endpoints keyed by dataset.
   - `collect_snapshot()` builds dataset manifests by combining:
     - Static dataset definitions (projects, issues, users, issue types, statuses, priorities, API surface).
     - Dynamic attribute discovery (custom issue fields).
     - API metadata (list of endpoints, docs, fully-qualified URLs).
3. **Metadata Collection Flow**
   - Temporal worker (`metadata_worker.py`) invokes `MetadataCollectionService`.
   - Service loads the Jira endpoint via `EndpointFactory` → obtains subsystem → executes `probe_environment`/`collect_snapshot`.
   - Output flows through `JiraMetadataNormalizer` to produce `CatalogSnapshot` persisted in cache/GraphQL.

## Dataset Coverage
- `jira.projects` — project catalog (key, type, lead, URL, description).
- `jira.issues` — work items plus every custom field discovered at runtime.
- `jira.users` — identities referenced by issues/projects.
- `jira.issue_types` — Jira hierarchy of issue types (standard/sub-task, custom).
- `jira.statuses` — workflow statuses with categories/colors.
- `jira.priorities` — priority dictionary.
- `jira.comments` — user conversations attached to issues (schema metadata only; actual records fetched via ingestion units).
- `jira.worklogs` — time tracking entries for issues.
- `jira.api_surface` — aggregated REST endpoints leveraged by Nucleus (method/path/scope/docs URL).

Each dataset includes `properties.apiEndpoints` and, where applicable, `properties.valueCatalog` with the live values returned by Jira.

## Ingestion filters & incremental semantics
Jira’s ingestion units (issues/comments/worklogs) now consume metadata-driven filters so admins can scope ingestion without authoring raw JQL:

- Filter options are sourced from the metadata datasets above: project keys (`jira.projects`), workflow statuses (`jira.statuses`), and assignee account IDs (`jira.users`).
- The ingestion console fetches these options via the new `jiraIngestionFilterOptions(endpointId)` GraphQL query and persists selections on the `IngestionUnitConfig.filter` JSON field.
- `updatedFrom` acts as the bootstrap watermark for dimensions that haven’t been ingested before (e.g., a newly added project in the filter).

To avoid replaying the entire tenant whenever filters change, Jira’s runtime maintains a **per-project transient state**. Temporal passes the stored transient JSON to the Python worker alongside the classic checkpoint, and the Jira handler merges its latest per-project cursors back into that state. Re-running with an expanded project list now:

1. Reuses existing project cursors (no replay).
2. Starts new projects from `filter.updatedFrom` (or all history if unspecified).

The same transient-state contract will be reused by future semantic sources that need multi-dimensional incremental cursors.

## Dynamic Attribute Handling
- `/rest/api/3/field` is queried once per environment probe to fetch all built-in and custom fields.
- Fields are normalized into a lightweight structure (id, key, name, schema type, operations, system/custom flags).
- During manifest construction the subsystem merges static schema fields with runtime-discovered ones, deduplicating by name and preserving metadata under `extras`.
- Future datasets can plug in additional `dynamic_fields_source`/`value_source` functions without touching the ingestion/console layers.

## API Inventory Modeling
- `API_LIBRARY` enumerates canonical Jira REST endpoints grouped by dataset scope (projects, issues, users, dictionaries, agile resources).
- `probe_environment` materializes this library into the `api_catalog`, resolving fully-qualified URLs using the tenant base URL.
- Dataset manifests embed the relevant subset under `properties.apiEndpoints`, while the dedicated `jira.api_surface` dataset presents the complete inventory for human/agent consumption.

## Extensibility
- Adding a new Jira-backed dataset requires only:
  1. Registering a new entry in `DATASET_DEFINITIONS` (static schema + API keys + optional value source).
  2. Ensuring the required REST payload is normalized inside `probe_environment`.
- The same patterns (dynamic field sourcing + API catalog) can be applied to future HTTP endpoints (e.g., Confluence, ServiceNow) by creating endpoint-specific metadata adapters with shared helper utilities.

## Open Questions / Future Enhancements
- **Agile Entities:** Boards/sprints currently appear in the API inventory but do not have dedicated datasets; once ingestion needs them we can add `value_source` adapters using the Agile API.
- **Rate Limit Telemetry:** We may want to enrich `api_catalog` with response timing and rate-limit headers captured during probing.
- **Caching Strategy:** For large tenants the field catalog can be ~MBs; consider caching the normalized result (with TTL) per endpoint to reduce repeated downloads.
- **Cross-product Specifications:** Future HLDs should converge Jira + Confluence + OneDrive semantics into a shared "semantic source" playbook once their metadata adapters adopt similar patterns.
