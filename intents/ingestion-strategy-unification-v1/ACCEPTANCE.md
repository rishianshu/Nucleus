# Acceptance Criteria

1) Adaptive planning interface powers JDBC, Jira, and Confluence ingestion
   - Type: integration / unit
   - Evidence:
     - Python tests construct endpoint instances for at least:
       - one JDBC template (e.g., `jdbc.postgres`),
       - Jira HTTP endpoint,
       - Confluence HTTP endpoint.
     - For each, calling `plan_incremental_slices(...)` returns an `IngestionPlan` with:
       - non-empty `slices`,
       - `strategy` name set appropriately,
       - reasonable slice parameters (e.g., time windows or ranges).
     - Existing JDBC planner is wrapped or refactored to satisfy this interface without regressions.

2) Temporal workflow uses Source → Staging → Sink with no bulk records in payloads
   - Type: integration
   - Evidence:
     - `ingestionRunWorkflow` invokes `pythonActivities.runIngestionUnit` with arguments containing only:
       - endpointId, unitId, sinkId, stagingProviderId, checkpoint, policy.
     - The activity response contains only:
       - checkpoint/state, stats, and slice metadata (no `NormalizedRecord[]` or raw row arrays).
     - Tests assert that the workflow:
       - allocates a staging session,
       - writes via `StagingSession.writer()`,
       - reads via `StagingSession.reader()` in the sink path,
       - and never serializes large record batches across Temporal.

3) Metadata-first ingestion invariant is enforced
   - Type: integration
   - Evidence:
     - Calling `startIngestion` with an endpoint/dataset pair where the dataset:
       - does not exist in the catalog, or
       - exists but is not ingestion-enabled
       results in a typed GraphQL error (`E_INGESTION_DATASET_UNKNOWN` or `E_INGESTION_DATASET_DISABLED`).
     - No `IngestionRun` record or `IngestionUnitState` transition is created in these failure cases.
     - For a valid endpoint/dataset with ingestion enabled, `startIngestion` succeeds and enqueues `ingestionRunWorkflow`.

4) CDM mapping is done via registry, not hardcoded in metadata_worker
   - Type: unit / integration
   - Evidence:
     - A CDM mapper registry module exists (e.g., `metadata_service.cdm.registry`) with APIs similar to `register_cdm_mapper` and `apply_cdm`.
     - Jira and Confluence runtime modules register their mappers through the registry.
     - `metadata_worker.py` (or ingestion runtime) calls `apply_cdm(...)` when policy mode is `cdm` and does not contain Jira/Confluence-specific CDM mapping branches.
     - Existing Jira/Confluence ingestion tests continue to pass using the registry path.

5) KV incremental state is consistent and used by planners
   - Type: integration
   - Evidence:
     - For a seeded JDBC dataset with an incremental column:
       - First run writes rows up to a specific watermark and persists that value in KV.
       - Second run only lands new rows above that watermark, as asserted by sink-side counts and KV state.
     - For a Jira dataset:
       - Two consecutive runs show updated watermarks per project/filter; the second run fetches only newer issues.
     - For a Confluence dataset:
       - Watermarks per space/time window behave similarly, with the second run skipping already-ingested pages.

6) No bulk rows in Temporal payloads
   - Type: unit / meta
   - Evidence:
     - TypeScript and Python typings/tests guarantee that `runIngestionUnit` activity inputs/outputs do not include `NormalizedRecord[]` or equivalent bulk data types.
     - A defensive test (e.g., schema/typing check or explicit assertion) ensures any attempt to add such fields fails.

7) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after the refactor, including:
       - ingestion-related TS tests,
       - Python ingestion tests,
       - Playwright specs that touch ingestion or ingestion console.
