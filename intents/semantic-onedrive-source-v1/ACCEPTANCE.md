# Acceptance Criteria

1) OneDrive endpoint template is registered and testable
   - Type: integration
   - Evidence:
     - `endpoint_registry_cli.py list --family onedrive` includes a descriptor with id `http.onedrive`.
     - `endpoint_registry_cli.py test --template http.onedrive --parameters '{...}'` performs a Graph API call and returns a JSON payload with:
       - `success: true` for valid dev credentials,
       - `capabilities` including `"metadata"` and `"ingestion"`.

2) OneDrive metadata collection produces catalog datasets
   - Type: integration / e2e
   - Evidence:
     - Creating a OneDrive endpoint via the metadata UI and running a collection populates `MetadataRecord` entries with:
       - `domain = "catalog.dataset"`,
       - `labels` including `onedrive` and `docs`,
       - payload describing an OneDrive docs dataset (name, rootPath, filters, CDM binding).
     - The Catalog UI shows at least one dataset associated with the OneDrive endpoint.

3) OneDrive ingestion uses unified planner and staging pipeline
   - Type: integration
   - Evidence:
     - For a OneDrive docs dataset, `ingestionUnits(endpointId)` exposes an ingestion unit whose id matches the dataset.
     - Starting ingestion for this unit:
       - calls the OneDrive planner via `plan_incremental_slices(...)` and yields at least one slice.
       - runs the Python worker which writes docs to a staging provider (no `NormalizedRecord[]` in Temporal payloads).
       - sink consumes from staging and writes rows into the configured docs sink (CDM mode or raw).
     - KV state for the unit is updated with a `lastModified` watermark after a successful run.

4) CDM Docs Explorer shows OneDrive docs
   - Type: e2e (Playwright)
   - Evidence:
     - After a successful OneDrive ingestion run in CDM mode, the CDM Docs Explorer’s Docs tab:
       - lists docs with “Source” or dataset labels indicating OneDrive.
       - can filter docs by OneDrive dataset using the Dataset selector.
       - shows at least one OneDrive doc row with non-empty Title and Updated fields.
     - Clicking a OneDrive doc row opens a detail panel with:
       - title, project/workspace, path, type, updated, source labels,
       - an “Open in source” link that points to an OneDrive URL pattern.

5) OneDrive ingestion is metadata-driven and validated
   - Type: integration
   - Evidence:
     - Attempting to start ingestion for an OneDrive endpoint without any catalog dataset for docs results in a typed GraphQL error (e.g., `E_INGESTION_DATASET_UNKNOWN`) and does not create an ingestion run.
     - Disabling ingestion for the OneDrive docs dataset (via config) and calling start ingestion returns `E_INGESTION_DATASET_DISABLED`.
     - Enabling ingestion and re-running succeeds and records an ingestion run.

6) CI is green with OneDrive tests
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after adding OneDrive endpoint/metadata/ingestion code.
     - Ingestion-related Python tests (e.g., OneDrive planner, worker behavior) are part of the test suite and pass.
