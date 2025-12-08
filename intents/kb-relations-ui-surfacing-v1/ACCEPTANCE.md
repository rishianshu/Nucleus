# Acceptance Criteria

1) KB explorer filters by relation kind
   - Type: e2e (Playwright) + integration
   - Evidence:
     - KB explorer UI exposes a facet or control for relation kinds (e.g., PK/FK, work links, doc attachments, drive hierarchy).
     - Selecting a relation kind updates the GraphQL query (kindFilter) and the node’s displayed edges match that filter.
     - A Playwright test toggles relation kinds and asserts that edges in the UI reflect the chosen kinds.

2) Node detail shows neighbors grouped by relation family
   - Type: e2e
   - Evidence:
     - Selecting a table node shows:
       - Structural neighbors (PK/FK, containing dataset, columns) under a “Schema” grouping.
     - Selecting a Jira work item node with `rel.work_links_work` edges shows linked work items under a “Work links” grouping and displays `linkType` metadata.
     - Selecting a Confluence doc node with `rel.doc_contains_attachment` edges shows attachments under a “Attachments” grouping.
     - Selecting a OneDrive drive/folder node with `rel.drive_contains_item` edges shows child items with folder/file indication.

3) Catalog table detail uses KB relations for PK/FK and related tables
   - Type: integration + e2e
   - Evidence:
     - For a seeded schema with at least one FK:
       - Catalog table detail page shows:
         - Primary key columns that match KB `rel.pk_of` edges.
         - Outbound and inbound foreign keys that match `rel.fk_references` edges.
         - A list of related tables (referenced and referencing).
     - Tests assert that changes in KB relations are reflected in the Catalog view (e.g., after a metadata collection test fixture).

4) GraphQL supports relation-aware queries with limits
   - Type: integration
   - Evidence:
     - New (or extended) GraphQL fields accept a `kindFilter` and `direction` for edges.
     - Tests verify:
       - Filtering by a specific relation kind returns only edges of that kind.
       - Limit is honored; requesting `limit: 10` never returns more than 10 edges.
       - Unknown or missing kinds do not break existing queries.

5) Semantic relations are visible in KB explorer for seeded connectors
   - Type: e2e
   - Evidence:
     - Using seeded test data for:
       - Jira (work_links_work),
       - Confluence (doc_contains_attachment),
       - OneDrive (drive_contains_item),
       the KB explorer renders at least one edge of each kind for their respective nodes.
     - A Playwright test (or similar) enters the KB explorer, selects one example for each connector, and asserts the presence of the correct relation types.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes with all new tests included.
     - No existing KB or Catalog UI tests regress.
