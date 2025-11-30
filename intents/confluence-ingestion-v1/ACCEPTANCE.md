# Acceptance Criteria

1) Confluence ingestion units & config are exposed
   - Type: unit / integration
   - Evidence:
     - GraphQL ingestion schema lists units for a Confluence endpoint (e.g., a unit with `datasetDomain = "confluence.page"` or equivalent).
     - Ingestion unit config for Confluence includes a `filter` field matching `ConfluenceIngestionFilter` (spaceKeys + updatedFrom).
     - The ingestion UI can:
       - select a Confluence endpoint as source,
       - select a sink endpoint,
       - choose `mode` (`raw` or `cdm`),
       - configure at least one space filter and save/reload the config.

2) Raw mode ingestion writes Confluence content to a sink
   - Type: integration
   - Evidence:
     - With a Confluence endpoint and sink endpoint configured and `mode="raw"`:
       - Running ingestion for a test unit:
         - issues HTTP calls to Confluence for the specified spaces.
         - emits normalized “raw Confluence page” records into staging.
         - sink receives and persists these records.
     - Tests verify that:
       - at least one page from a test space appears in the sink (e.g., by id/title).
       - running the job twice with no changes does not create duplicate logical entries (either via idempotent sink or upsert semantics).

3) CDM mode ingestion writes docs CDM rows to the CDM docs sink
   - Type: integration
   - Evidence:
     - With `mode="cdm"` and a CDM docs sink configured:
       - Ingestion run maps Confluence pages to `CdmDocItem`/`CdmDocRevision` using the Confluence→CDM mappers.
       - The CDM docs sink tables contain rows for at least one test page.
     - Tests assert:
       - `cdm_id` matches expected pattern (`cdm:doc:item:confluence:...`),
       - key CDM fields (title, space_cdm_id, created_at/updated_at, URL) are filled.

4) Per-space incremental behavior via updatedAt watermarks
   - Type: integration
   - Evidence:
     - Configure ingestion for one Confluence space with `updatedFrom` set.
     - First run:
       - fetches pages updated since `updatedFrom`.
       - writes KV watermark for that space with the max `updatedAt`.
     - Create/update a page in that space with a later `updatedAt`.
     - Second run:
       - only fetches pages updated after the stored watermark (previous pages are not re-fetched).
     - Tests can simulate page updates via a stub Confluence service and inspect KV state.

5) CI and coverage
   - Type: meta
   - Evidence:
     - New unit/integration tests for Confluence ingestion handlers (Python).
     - TS/GraphQL tests for ingestion unit/config handling.
     - At least one Playwright test that:
       - uses a seeded/stub Confluence dataset,
       - configures a Confluence ingestion unit,
       - triggers ingestion,
       - and verifies some evidence in the UI or via a test-only endpoint.
     - `pnpm ci-check` remains green.


⸻

4) runs/confluence-ingestion-v1/RUNCARD.md

