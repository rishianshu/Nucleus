## ingestion-source-staging-sink-v1 Plan

1. **Survey & gap assessment**
   - Read INTENT/SPEC/ACCEPTANCE + architecture docs (MAP/ENDPOINTS/INGESTION) to confirm desired Source→Staging→Sink model.
   - Inspect current ingestion-core implementation (apps/metadata-api `temporal/workflows.ts`, `activities.ts`, `ingestion/*`, and Python ingestion runtime) to understand where TS duplicates endpoint concepts.

2. **Documentation deliverables**
   - Produce `docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md` capturing the canonical data-plane (SourceEndpoint → StagingProvider → SinkEndpoint), staging provider contract, export/import lifecycles, and roles of KV/KB/SinkEndpoints.
   - Update `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md` (and link from MAP if needed) to de-emphasize TS `IngestionDriver/Sink`, highlight the Python ingestion worker, and explain orchestration/state responsibilities.

3. **Workflow/implementation changes**
   - Introduce a Python activity (`runIngestionUnitPythonWorker`) within `platform/spark-ingestion/temporal/metadata_worker.py` (or a sibling worker) that can execute one ingestion unit using the runtime (even if in-memory stub for now).
   - Update TypeScript `temporal/activities.ts` + `workflows.ts` to call the new Python activity instead of in-process TS driver/sink logic, keeping `startIngestionRun` / `completeIngestionRun` responsible for KV + Prisma updates.
   - Gate/mark the legacy TS `IngestionDriver/Sink` path as deprecated/legacy helper (if still referenced) to satisfy docs.

4. **Validation**
   - Adjust/add tests to reflect new workflow wiring (unit + integration as feasible).
   - Run `make ci-check` (or equivalent) ensuring metadata-api/ui + docs tasks pass.
