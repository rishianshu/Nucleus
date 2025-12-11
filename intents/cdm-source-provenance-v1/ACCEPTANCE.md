# Acceptance Criteria

1) CDM Work/Docs schemas extended with provenance fields  
   - Type: migration / unit  
   - Evidence:
     - Database migrations add `source_system`, `source_id`, `source_url`, `raw_source` (JSONB) to CDM work and doc tables.
     - Corresponding TypeScript row types include these fields as nullable.
     - Migrations run successfully in dev and CI environments.

2) Ingestion mappers populate provenance for Jira/Confluence/OneDrive  
   - Type: unit / integration  
   - Evidence:
     - CDM mappers for Jira, Confluence, and OneDrive are updated to:
       - Set `source_system` to a stable value (e.g., "jira", "confluence", "onedrive").
       - Set `source_id` to a stable, documented identifier from the source.
       - Set `source_url` to a usable deep link.
       - Set `raw_source` to a curated subset of the upstream JSON payload (no large binary content).
     - Tests or fixtures show that ingesting sample items from each connector results in populated provenance fields.

3) CDM GraphQL/API exposes provenance fields  
   - Type: integration  
   - Evidence:
     - Work/doc GraphQL types include fields (e.g. `sourceSystem`, `sourceId`, `sourceUrl`, `rawSource`).
     - At least one integration test queries a CDM item and asserts the presence of provenance fields.
     - UI/CDM explorer shows "Open in source" using `sourceUrl` on work/doc detail pages (or equivalent button/anchor).

4) Documentation of provenance semantics and pattern  
   - Type: docs  
   - Evidence:
     - A doc (e.g., `docs/meta/nucleus-architecture/CDM_SOURCE_PROVENANCE.md` or updates to CDM docs) describes:
       - The four provenance fields and their intended use.
       - Connector-specific examples for Jira, Confluence, and OneDrive.
       - Guidance for adding provenance to new CDM models in the future.
     - The document clarifies that `raw_source` should contain bounded metadata JSON, not large content blobs.

5) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes with the new migrations, code changes, and tests.
     - No existing tests are skipped or removed to make this slug pass.
