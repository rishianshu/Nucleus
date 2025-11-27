# Acceptance Criteria

1) Ingestion config supports structured Jira filters
   - Type: unit / integration
   - Evidence:
     - Ingestion unit configuration model includes a `filter` field with shape matching `JiraIngestionFilter`.
     - GraphQL API exposes `filter` on Jira units in both read and write paths.
     - Saving a config with projects/statuses/users persists and can be read back identically.

2) Filters are driven by Jira metadata
   - Type: integration / e2e
   - Evidence:
     - UI for Jira ingestion units:
       - populates project options from Jira metadata (projects dataset),
       - populates user options from Jira metadata (users dataset),
       - populates status options from Jira metadata.
     - Tests verify that options list matches seeded Jira metadata.

3) Jira ingestion uses per-dimension incremental state
   - Type: unit / integration
   - Evidence:
     - A test creates an ingestion config for Jira issues with a filter for two projects (e.g., PROJ1, PROJ2) and `updatedFrom` set.
     - After a run:
       - KV contains per-project cursors with `lastUpdatedAt` populated.
     - A subsequent run:
       - makes requests with `updatedAt` > per-project `lastUpdatedAt` (verified via logs or mocks),
       - does not re-fetch older issues.

4) Filter changes do not force full reload
   - Type: integration
   - Evidence:
     - Start with filter for project PROJ1 only; run ingestion; cursors stored for PROJ1.
     - Update filter to include PROJ2:
       - Next run:
         - Reuses PROJ1 cursor (no full reload of PROJ1 history),
         - Starts PROJ2 from `updatedFrom` (or from scratch if unset).
     - Tests confirm that:
       - PROJ1 issues before its cursor are not fetched again,
       - PROJ2 issues from before `updatedFrom` are included exactly once.

5) Transient state abstraction is used by Jira ingestion endpoint
   - Type: unit
   - Evidence:
     - Jira ingestion endpoint code uses a `TransientState`-like interface to read/write pagination and cursor state.
     - Tests simulate partial runs and retries by:
       - seeding state with an existing cursor,
       - calling ingest_batch,
       - confirming that calls resume from the cursor instead of starting over.

