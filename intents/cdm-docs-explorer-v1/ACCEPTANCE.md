# Acceptance Criteria

1) Docs tab lists CDM docs with meaningful columns
   - Type: e2e (Playwright)
   - Evidence:
     - In the CDM Explorer, switching to the Docs tab shows a table with columns:
       - Project/workspace, Title, Type, Source, Updated.
     - With the seeded Confluence harness data, at least one row is shown with non-empty Title, Type, Source, and Updated values.

2) Dataset/source filters and search affect results
   - Type: e2e + integration
   - Evidence:
     - GraphQL exposes `cdmDocsDatasets` with at least one dataset for Confluence test data (and OneDrive if seeded).
     - The Docs tab has a “Dataset” selector populated from `cdmDocsDatasets`.
     - Selecting a specific dataset filters the table so only docs from that dataset are shown.
     - If a source filter is present (e.g., Confluence vs OneDrive), toggling sources changes the set of visible rows accordingly.
     - Entering a term in the search bar restricts visible docs to those matching title/path/excerpt, as asserted by a Playwright test.

3) Row selection opens a document detail panel
   - Type: e2e
   - Evidence:
     - Clicking a doc row highlights it and opens a detail panel on the right without causing the entire table to reload.
     - The detail panel shows:
       - Full title,
       - Project/workspace,
       - Dataset and source labels,
       - Last updated,
       - A human-readable location/path,
       - A content excerpt.
     - The panel includes actions:
       - “Open in source” (href to the underlying Confluence/OneDrive URL in the harness),
       - “View dataset” (link to the corresponding catalog dataset or ingestion view).

4) Raw CDM payload is accessible
   - Type: e2e + integration
   - Evidence:
     - The detail panel includes a section or tab showing JSON for the underlying CDM doc.
     - The JSON corresponds to the `CdmEntity.data` (or equivalent) returned by GraphQL for that row, as verified in an integration test.

5) CdmEntity exposes docs-specific fields and dataset identity
   - Type: unit / integration
   - Evidence:
     - GraphQL schema for `CdmEntity` includes fields:
       - `docTitle`, `docType`, `docProjectKey`, `docLocation`, `docUpdatedAt`, `docSourceSystem`, `docDatasetId`, `docDatasetName`.
     - Integration tests:
       - For entities with `domain = DOCS`, these fields are populated consistently with the seeded Confluence docs.
       - `docDatasetId` and `docDatasetName` match an entry from `cdmDocsDatasets`.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after all changes, including Playwright and GraphQL tests for the Docs explorer.
