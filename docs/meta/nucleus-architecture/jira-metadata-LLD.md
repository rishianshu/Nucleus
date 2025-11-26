# Jira Metadata Subsystem — Low Level Design

## Modules & Files
| Component | Path | Responsibility |
|-----------|------|----------------|
| `JiraMetadataSubsystem` | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/adapters/jira.py` | Implements `MetadataSubsystem` contract for Jira HTTP endpoints (environment probing, dataset manifests, API catalog). |
| `JiraMetadataNormalizer` | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/normalizers/jira.py` | Converts raw dataset manifests into `CatalogSnapshot` models consumed by metadata collection + KB. |
| `JiraEndpoint` | `platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/jira_http.py` | SourceEndpoint descriptor that instantiates the metadata subsystem (when available) and exposes ingestion helpers. |
| `MetadataCollectionService` | `platform/spark-ingestion/packages/metadata-service/src/metadata_service/collector.py` | Orchestrates metadata jobs by invoking endpoint metadata subsystems via Temporal worker. |

## Data Structures
### `API_LIBRARY`
Dictionary keyed by logical endpoint id → `{ method, path, description, docs, scope }`. Used to derive:
- Dataset-specific API references (`properties.apiEndpoints`).
- `jira.api_surface` dataset and the global `api_catalog`.

### `DATASET_DEFINITIONS`
Schema describing each Jira dataset. Key fields:
- `static_fields`: baseline schema entries for the dataset.
- `dynamic_fields_source`: (optional) key referencing a catalog source (e.g. `issue_fields`) to augment schema fields dynamically.
- `value_source`: (optional) key referencing a catalog source (e.g. `statuses`, `priorities`, `api_catalog`) to embed enumerations/samples.
- `api_keys`: subset of API ids (from `API_LIBRARY`) relevant to the dataset.

## Control Flow
1. **`probe_environment(config)`**
   - Normalize endpoint parameters (base URL, auth, scope filters) using the shared Jira runtime helper.
   - Perform HTTP GETs:
     - `/rest/api/3/serverInfo`, `/rest/api/3/myself` for deployment+user data.
     - `/rest/api/3/field`, `/status`, `/priority`, `/issuetype` to capture dictionaries/custom-fields.
   - Build `catalog_sources` by normalizing the REST payloads:
     - `issue_fields` → simplified `{id,key,name,type,...}` entries.
     - `statuses`, `priorities`, `issue_types` → dictionaries with IDs/names/category metadata.
   - Generate `api_catalog` by materializing `API_LIBRARY` with the tenant’s base URL and grouping entries per dataset.
   - Return environment payload consumed later by `collect_snapshot`.
2. **`collect_snapshot(config, environment)`**
   - Determine dataset (defaults to `jira.issues` when not specified).
   - Build dataset manifest:
     - Merge `static_fields` with dynamic fields produced by `_build_dynamic_fields(dynamic_source, environment)`, deduplicating by name.
     - Embed API metadata via `_resolve_api_endpoints`.
     - Attach live enumerations/value catalogs when `value_source` is set (e.g., statuses/priorities lists).
     - Store additional context (project keys filters, JQL filters, datasetId, API catalog reference).
   - Compose datasource descriptor (base URL, deployment type, authenticated user) for downstream normalizer.
   - Pass manifest → `JiraMetadataNormalizer.normalize()` → `CatalogSnapshot`.

## Helper Functions
- `_simplify_issue_fields`, `_simplify_statuses`, `_simplify_priorities`, `_simplify_issue_types`: Convert raw Jira REST responses into compact dictionaries stored in `environment["catalog_sources"]`.
- `_build_dynamic_fields`: Turn catalog source entries into dataset field definitions (name, data type, extras).
- `_merge_fields`: Append runtime-discovered fields without duplicating static schema entries.
- `_materialize_api_endpoint`: Resolve API metadata from `API_LIBRARY` and attach fully-qualified URLs.
- `_resolve_value_catalog`: Pull the requested catalog (statuses/priorities/issue types/API inventory) from the environment for embedding into dataset properties.

## Environment Payload Contract
```jsonc
{
  "dialect": "jira",
  "base_url": "https://example.atlassian.net",
  "deployment_type": "Cloud",
  "version": "1001.0.0-SNAPSHOT",
  "project_keys": ["ENG", "OPS"],
  "authenticated_user": { "accountId": "...", "displayName": "...", "email": "..." },
  "probe_time": "2025-11-24T04:46:09Z",
  "catalog_sources": {
    "issue_fields": [ { "id": "customfield_10010", "name": "Epic Link", ... }, ... ],
    "statuses": [ { "id": "1", "name": "To Do", "category": "To Do" }, ... ],
    "priorities": [ { "id": "3", "name": "Medium" }, ... ],
    "issue_types": [ { "id": "10001", "name": "Epic", "hierarchyLevel": 2 }, ... ]
  },
  "api_catalog": {
    "baseUrl": "https://example.atlassian.net",
    "reference": "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
    "datasets": {
      "jira.issues": [
        { "key": "issue_search", "method": "GET", "path": "/rest/api/3/search", ... },
        ...
      ],
      "jira.api_surface": [... all APIs ...]
    }
  }
}
```

## Extension Hooks
- **New Dictionaries:** Add API fetch + `_simplify_<entity>` helper, register `value_source` in `DATASET_DEFINITIONS`.
- **Additional Datasets:** Extend `DATASET_DEFINITIONS` (schema + API keys); optional `dynamic_fields_source` can reuse existing catalog sources or introduce new ones.
- **Caching/Rate Limits:** `probe_environment` can be wrapped with caching logic or rate-limit telemetry without affecting consumers because environment structure is JSON-based.

## Testing Considerations
- Mock Jira REST responses for `/field`, `/status`, `/priority`, `/issuetype` to validate:
  - Dynamic field merging order.
  - Value catalog embedding.
  - API catalog completeness per dataset.
- Add snapshot-style tests for `collect_snapshot` (per dataset) to ensure schema + API metadata remain stable when definitions evolve.
