[x] Add relation-kind registry (code + meta) for rel.contains.*, rel.pk_of, rel.fk_references, rel.doc_links_*.
[x] JDBC relations: emit containment + PK/FK via relation kinds (idempotent, guarded beyond Postgres as feasible).
[x] Doc relation: emit explicit doc→issue or doc→doc links into KB edges.
[x] GraphQL: expose tables/columns PK/FK + doc links using KB edges.
[x] UI: surface relation kinds in Catalog/Docs/Work detail and KB admin (filter/view) — partial (catalog drawer PK/FK).
[x] Tests and `pnpm ci-check` once wiring is complete.
