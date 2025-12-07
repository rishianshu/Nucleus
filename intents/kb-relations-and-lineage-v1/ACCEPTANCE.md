# Acceptance Criteria

1) KB contains containment and PK/FK edges for seeded JDBC schemas
   - Type: integration
   - Evidence:
     - For a seeded Postgres schema (used in tests), KB contains:
       - `dataset` nodes for the catalog datasets.
       - `table` nodes for each table.
       - `column` nodes for columns.
       - `CONTAINS_TABLE` edges from dataset → table.
       - `CONTAINS_COLUMN` edges from table → column.
       - `HAS_PRIMARY_KEY` edges from table → column(s) that form the PK.
       - `REFERENCES_COLUMN` edges from FK columns to referenced PK columns.
     - A KB query (or unit test using GraphStore) can assert these relationships for at least one example schema.

2) GraphQL exposes structural relations clearly
   - Type: integration
   - Evidence:
     - Dataset GraphQL type exposes a `tables` field listing its tables.
     - Table GraphQL type exposes:
       - `columns`,
       - `primaryKeyColumns`,
       - `inboundForeignKeys`,
       - `outboundForeignKeys`.
     - ForeignKey GraphQL type exposes from/to tables and columns and optional `name`, `onDelete`, `onUpdate`.
     - A GraphQL integration test verifies that querying a known table returns correct PK and FK info.

3) Catalog dataset/table detail UI shows PK/FK relations
   - Type: e2e (Playwright)
   - Evidence:
     - Opening a dataset in the Catalog UI shows its tables.
     - Opening a table detail view shows:
       - A list of PK columns (if any).
       - A list of outbound FKs with target table names.
       - A list of inbound FKs with source table names.
     - Playwright tests assert that seeded FK relationships appear in the UI as expected.

4) KB admin console can inspect structural edges
   - Type: e2e / integration
   - Evidence:
     - KB admin console (or an equivalent admin view) allows:
       - Filtering nodes/edges by type (dataset/table/column, PK/FK).
       - Selecting a table node and seeing its PK/FK edges.
     - An automated test or snapshot confirms that at least one FK edge is visible from the admin view.

5) Ingestion remains incremental and stable
   - Type: integration
   - Evidence:
     - Running metadata collection twice for the same JDBC endpoint:
       - Does not create duplicate PK/FK edges.
       - Updates edges if the schema changes (e.g., new FK added).
     - A test ensures idempotent behaviour for KB writes (upserts) based on the same physical schema.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after all changes.
     - New KB/graph and UI tests are part of the CI run.
