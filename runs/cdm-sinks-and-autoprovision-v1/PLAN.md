# Plan

1. **Study existing ingestion sink plumbing** – review `@metadata/core` sink interfaces, current KB sink, and Temporal persist activity to understand how sink instances receive records and context. Inspect runtime_common endpoint/templates to mirror descriptor semantics.

2. **Implement CDM sink template & registry hooks** – add a `cdm.jdbc` template (Postgres-backed) with capability metadata, update sink registration (TypeScript) to include a new `CdmSink`, and define mapping metadata for supported CDM models.

3. **Autoprovision flow** – introduce a GraphQL mutation (and backing service logic) that, given a CDM sink endpoint + `cdm_model_id`, executes idempotent DDL (via Prisma raw SQL) to create the required tables/schema and registers the resulting dataset(s) in the catalog store.

4. **Wire ingestion to CDM sink** – extend `persistIngestionBatches` and the CDM sink implementation so CDM-mode runs transform Jira records (already done) and insert rows into the provisioned tables while raw mode continues to route to existing sinks unchanged.

5. **Docs & verification** – add/update docs (INGESTION_AND_SINKS, CDM model doc) to describe the CDM sink/autoprovision flow, and add automated tests covering sink registration, mutation validation+DDL behavior, and CDM ingestion writing. Finish with `pnpm ci-check`.
