## Plan
- Re-read INTENT/SPEC/ACCEPTANCE and prior work to restate scope (generic relation metadata across domains).
- Define and implement a relation-kind registry (code + meta) for structural and cross-entity relations (rel.contains.*, rel.pk_of, rel.fk_references, rel.doc_links_*), keeping changes additive.
- Generalize relation emission:
  - JDBC: emit dataset→table→column containment + PK/FK using relation kinds; keep idempotent/bounded, guard non-Postgres as feasible.
  - Docs: emit one explicit doc relation (doc→issue or doc→doc) using existing link metadata.
- Extend GraphQL schema/resolvers to expose relations (tables/columns PK/FK, doc links) via KB edges.
- Update UI (Catalog, Docs/Work detail, KB admin) to visualize relation kinds and allow filtering (additive only).
- Add tests (registry, JDBC relations, doc relations, GraphQL/UI) and run `pnpm ci-check` or targeted suites.

## Notes
- Relations are metadata-first; KB is canonical. Avoid client-side inference; prefer KB edges.
- Keep ingestion incremental-friendly and idempotent; avoid O(N²) when emitting edges.
