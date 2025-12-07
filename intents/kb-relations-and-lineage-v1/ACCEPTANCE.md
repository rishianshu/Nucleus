# Acceptance Criteria

1) Relation-kind registry exists with core kinds
   - Type: unit / integration
   - Evidence:
     - A registry structure or API exposes at least:
       - `rel.contains.table`, `rel.contains.column`,
       - `rel.pk_of`, `rel.fk_references`,
       - `rel.doc_links_issue` or `rel.doc_links_doc`.
     - Tests assert that each kind includes allowed from/to types.

2) JDBC structural relations are persisted in KB
   - Type: integration
   - Evidence:
     - After running JDBC metadata collection for a seeded schema:
       - KB has `dataset`, `table`, `column` entities.
       - KB contains `rel.contains.table` edges dataset→table.
       - KB contains `rel.contains.column` edges table→column.
       - KB contains `rel.pk_of` edges table→PK column(s).
       - KB contains `rel.fk_references` edges fk column→pk column.
     - A test using the GraphStore client verifies these relations for at least one known FK.

3) One doc relation (doc↔issue or doc↔doc) is persisted in KB
   - Type: integration
   - Evidence:
     - Seeded fixtures for Confluence + Jira (or just Confluence) produce KB entities:
       - `doc` (page),
       - `work_item` (issue) or another `doc`.
     - KB contains at least one `rel.doc_links_issue` or `rel.doc_links_doc` edge connecting them.
     - A test asserts that the correct doc/work pair is related.

4) GraphQL exposes relations to clients
   - Type: integration
   - Evidence:
     - A GraphQL query for a seeded table returns:
       - `columns`,
       - `primaryKeyColumns`,
       - `inboundForeignKeys`,
       - `outboundForeignKeys`, which match the KB relations.
     - A GraphQL query for a seeded doc returns:
       - `linkedIssues` or `linkedDocs` that align with the KB relation edges.

5) UI can inspect relations (KB admin + detail views)
   - Type: e2e (Playwright) or snapshot integration
   - Evidence:
     - KB admin console allows filtering edges by relation kind (e.g. PK/FK vs doc-links).
     - Catalog table detail view shows PK/FK information based on KB, not hardcoded fixtures.
     - Docs or Work explorer detail shows linked issues/docs for the seeded relation.

6) Ingestion is idempotent and CI is green
   - Type: integration / meta
   - Evidence:
     - Running JDBC metadata collection twice does not create duplicate relation edges (verified via GraphStore queries).
     - `pnpm ci-check` passes with new tests included.
