# Acceptance Criteria

1) GraphQL CDM work queries implemented
   - Type: unit / integration
   - Evidence:
     - The GraphQL schema exposes:
       - `cdmWorkProjects`
       - `cdmWorkItems(filter, first, after)`
       - `cdmWorkItem(cdmId)`
     - Resolvers read from the CDM work tables (project/item/comment/worklog) created by `cdm-sinks-and-autoprovision-v1`.
     - Unit/integration tests:
       - Seed CDM tables with a small dataset.
       - Assert that queries return the expected projects, items (with filters), and item detail.

2) CDM work list view in UI
   - Type: e2e (Playwright) / integration
   - Evidence:
     - Navigating to the `CDM → Work` section shows:
       - A project filter, status filter, and text search.
       - A table/list of work items (when data exists) with summary, project, status, priority, assignee.
     - Changing filters updates the list appropriately (e.g., filtering by project reduces items to only that project).
     - When no CDM items exist, the UI shows an empty state message, not a crash.

3) Work item detail view
   - Type: e2e / integration
   - Evidence:
     - Clicking a row in the work items list navigates to a detail route for that item.
     - The detail view shows:
       - Header fields: summary, project, status, priority, assignee, created/updated dates.
       - Comments tab/section listing comments (if any) with author and body.
       - Worklogs tab/section listing worklog entries (if any) with author and time spent.
     - Empty comments/worklogs are handled with a clear “no comments/worklogs” message.

4) Auth and separation from Jira/raw
   - Type: integration
   - Evidence:
     - Accessing CDM work queries and UI requires the same viewer/admin role as other metadata consoles (verified via tests or config).
     - GraphQL responses and UI fields expose CDM-level names/IDs; there are no direct Jira API calls in these resolvers (data comes from CDM tables).
