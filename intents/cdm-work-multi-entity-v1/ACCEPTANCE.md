# Acceptance Criteria

1) Work tab supports multiple Work entity types
   - Type: e2e (Playwright)
   - Evidence:
     - CDM Explorer → Work shows an Entity selector with at least: Issues, Comments, Worklogs.
     - Switching between Issues/Comments/Worklogs changes the query and columns, not just labels.
     - For a seeded Jira dataset, each entity type returns at least one row in the harness environment.

2) Per‑entity column sets are present and populated for Jira data
   - Type: integration + e2e
   - Evidence:
     - For the Issues entity:
       - Columns include: Project, Key, Summary, Status, Priority, Assignee, Updated, Dataset.
       - At least Status, Assignee, and Updated are non‑empty for seeded Jira issues.
     - For the Comments entity:
       - Columns include: Project, Parent key, Author, Created, Body excerpt, Dataset.
       - Seeded Jira comments show non‑empty Parent key and Author.
     - For the Worklogs entity:
       - Columns include: Project, Parent key, Author, Time spent, Started, Updated, Dataset.
       - Seeded Jira worklogs show non‑empty Parent key and Time spent.

3) Dataset filter and dataset metadata work per Work entity
   - Type: integration + e2e
   - Evidence:
     - GraphQL exposes `cdmWorkDatasets` with entries for each CDM Work dataset (e.g., CUS Issues, CUS Comments, CUS Worklogs), each tagged with an `entityKind`.
     - The Work tab shows a Dataset dropdown populated from `cdmWorkDatasets` for the selected entity kind.
     - Selecting a specific dataset filters the table so only rows from that dataset are shown.
     - The table includes a Dataset column using the same friendly labels.

4) Row selection opens a detail panel without refetching the table
   - Type: e2e
   - Evidence:
     - Clicking a row in any Work entity view highlights the row and opens a detail panel on the right.
     - The table does not visibly reload; existing rows remain.
     - The detail panel shows:
       - all core fields for that entity kind (e.g., full summary/body, timestamps),
       - the endpoint and dataset labels,
       - an “Open in source” link (Jira URL in harness) and an “Open dataset” link.
       - a “Raw CDM record” section using data from the `raw` field.
     - Closing the detail panel leaves the current filters/selection intact.

5) Work GraphQL APIs are additive and tested
   - Type: unit / integration
   - Evidence:
     - Schema includes `CdmWorkEntityKind`, `CdmWorkDataset`, `cdmWorkDatasets`, and connection queries for `cdmWorkItems`, `cdmWorkComments`, and `cdmWorkLogs`.
     - New unit/integration tests:
       - Query each of the three Work entity connections with test filters and assert that at least one seeded record is returned.
       - Query `cdmWorkDatasets` and assert datasets are partitioned by `entityKind`.
     - Existing tests for pre‑slug Work item queries still pass unchanged.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after changes and includes updated Playwright and GraphQL tests for multi‑entity Work Explorer behavior.
