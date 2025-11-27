## 3) `intents/cdm-sinks-and-autoprovision-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) CDM sink endpoint exists with declared capabilities
   - Type: unit
   - Evidence:
     - `cdm.jdbc` template captured in `apps/metadata-api/src/fixtures/default-endpoint-templates.ts:356-434`.
     - Sink registration exposes `supportedCdmModels` via `apps/metadata-api/src/ingestion/index.ts:6-11`.
     - `apps/metadata-api/src/ingestion/ingestionResolvers.test.ts:244-340` asserts the descriptor is surfaced with CDM coverage.

2) Autoprovision creates CDM tables idempotently
   - Type: integration
   - Evidence:
     - Provisioning service (`apps/metadata-api/src/ingestion/cdmProvisioner.ts`) issues `CREATE SCHEMA/TABLE IF NOT EXISTS` for each model; test coverage in `apps/metadata-api/src/ingestion/cdmProvisioner.test.ts` validates repeated runs.
     - GraphQL mutation `provisionCdmSink` wires into the service (`apps/metadata-api/src/schema.ts:640-758,1685-1755`).

3) CDM tables are visible as catalog datasets
   - Type: integration
   - Evidence:
     - Provisioner persists `catalog.dataset` entries with sink + CDM labels (`apps/metadata-api/src/ingestion/cdmProvisioner.ts:61-74`); test `cdmProvisioner.test.ts` asserts the record content.
     - Docs capture catalog expectations (`docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md:40-84`, `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md:1-95`).

4) CDM-mode ingestion writes successfully to CDM sink
   - Type: integration
   - Evidence:
     - Temporal activities now pass `sinkEndpointId`, `dataMode`, and `cdmModelId` through to the sink (`apps/metadata-api/src/temporal/activities.ts:430-553`, `apps/metadata-api/src/temporal/workflows.ts:200-235`).
     - Python worker applies CDM mapping only when requested (`platform/spark-ingestion/temporal/metadata_worker.py:304-334`).
     - CDM sink writes Postgres rows with parameterized upserts; tests validate SQL emission via fake executors (`apps/metadata-api/src/ingestion/cdmSink.ts`, `apps/metadata-api/src/ingestion/cdmSink.test.ts`).
     - End-to-end `pnpm ci-check` run (see `/tmp/ci-check.log`) exercises ingestion consoles/Temporal flows without regression.
````

---
