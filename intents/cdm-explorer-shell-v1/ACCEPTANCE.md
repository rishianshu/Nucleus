# Acceptance Criteria

1) CDM Explorer shell with Work and Docs tabs exists
   - Type: e2e (Playwright)
   - Evidence:
     - The Metadata UI sidebar contains a single “CDM Explorer” entry.
     - Navigating to it shows at least two tabs: “Work” and “Docs”.
     - Switching tabs does not reload the entire app; only the tab content changes.

2) Work tab preserves previous work explorer behavior
   - Type: e2e + regression
   - Evidence:
     - A Playwright test that previously verified the Work Explorer still passes, updated to use the new route.
     - The Work tab:
       - lists CDM work items,
       - supports existing filters (e.g., project, status, search),
       - opens a detail view with the same fields as before (title, description, status, project, link to source).
     - No loss of functionality vs. `cdm-work-explorer-v1` expectations.

3) Docs tab shows CDM docs data with filters
   - Type: e2e + integration
   - Evidence:
     - With Confluence ingestion seeded, the Docs tab:
       - lists at least one doc item (e.g., a Confluence page).
       - supports filtering by:
         - sourceSystem (e.g., filter to `confluence`),
         - space (if metadata is present),
         - search by title.
       - opens a detail view showing title, space, sourceSystem, timestamps, and a link to view in source (Confluence).
     - A Playwright test covers this flow in a stubbed/harnessed environment.

4) Generic CDM entity GraphQL query exists and is used
   - Type: unit / integration
   - Evidence:
     - GraphQL schema includes:
       - `CdmEntity`, `CdmEntityFilter`, `CdmEntityConnection`, `cdmEntities`, and `cdmEntity`.
     - Unit/integration tests:
       - Query `cdmEntities` with `domain = WORK_ITEM` returns entities mapped from CDM work sink.
       - Query `cdmEntities` with `domain = DOC_ITEM` returns entities mapped from CDM docs sink.
     - The new CDM Explorer shell uses `cdmEntities` for at least its list views.

5) Backwards compatibility for work CDM APIs
   - Type: unit / integration
   - Evidence:
     - Existing work CDM GraphQL queries (e.g. `cdmWorkItems`) remain available with unchanged signatures.
     - Tests referencing these queries still pass.
     - No existing client code is broken by the introduction of the CDM entity envelope.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after the changes and includes the new tests for CDM Explorer shell.
