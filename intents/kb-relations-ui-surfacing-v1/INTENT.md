- title: KB relations and lineage v1 (generic relation framework)
- slug: kb-relations-and-lineage-v1
- type: feature
- context:
  - apps/metadata-api/src/schema.ts (KB + catalog + CDM resolvers)
  - apps/metadata-api/src/graph/* (GraphStore client, KB persistence)
  - apps/metadata-ui (KB admin console, Catalog dataset/table/column detail, CDM explorers)
  - platform/spark-ingestion (JDBC + Jira + Confluence metadata/ingestion)
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/kb-meta-registry-v1.md
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- why_now: Nucleus’s value comes from connecting things, not just listing tables or docs. Today the KB only expresses a thin set of edges, and our earlier design for “relations & lineage” focused almost entirely on JDBC PK/FK. We need a generic relation capability where many subsystems (JDBC, Jira, Confluence, OneDrive, GitHub, etc.) can publish relations as metadata. PK/FK is one important relation kind for JDBC, but Confluence→Jira links, doc↔doc links, and doc↔dataset links should use the same framework.
- scope_in:
  - Define a generic relation model for the KB:
    - A registry of relation kinds (e.g. `rel.contains`, `rel.pk_of`, `rel.fk_references`, `rel.doc_links_issue`, `rel.doc_links_doc`).
    - A consistent way to store relation instances in KB (edges) with metadata (source, strength, tags).
  - Implement at least two concrete relation families end-to-end:
    - Structural (JDBC): dataset → table → column containment, PK and FK relations.
    - Cross-entity: a simple doc relation (e.g. Confluence page ↔ Jira issue, or doc ↔ doc) using existing explicit links or IDs.
  - Expose relations via GraphQL in a machine-friendly way (for humans and agents).
  - Surface relations in:
    - KB admin console (filter by relation kind, inspect neighbors),
    - Catalog and/or CDM detail views (e.g. table FK graph, doc “linked issues”).
- scope_out:
  - Full-blown runtime lineage over query logs or ETL graphs.
  - Rich semantic inference (e.g. NLP-based relation discovery across arbitrary text).
  - Exhaustive coverage of all possible relation kinds (v1 focuses on the framework + 2 concrete families).
- acceptance:
  1. A relation-kind registry exists and is queryable (code + KB meta), with entries for at least: containment, PK, FK, and one doc relation.
  2. JDBC metadata ingestion populates KB with containment + PK/FK relations using the generic model.
  3. At least one doc relation (e.g. Confluence page ↔ Jira issue) is ingested into KB using the generic model.
  4. GraphQL exposes these relations for datasets/tables/columns and for the chosen doc relation.
  5. KB admin console can list and filter relations by kind and inspect neighbors.
  6. `pnpm ci-check` remains green.
- constraints:
  - KB schema changes must be additive; do not break existing node/edge types.
  - Relation ingestion must be incremental and avoid O(N²) behavior for large schemas.
  - GraphQL changes are additive (no breaking changes).
- non_negotiables:
  - All relation instances are derived from source metadata (no heuristic guessing in v1).
  - The relation framework is generic enough that future sources (GitHub, OneDrive, more doc types) can plug in without redesign.
- refs:
  - intents/catalog-view-and-ux-v1/*
  - intents/kb-admin-console-v1/*
  - intents/semantic-jira-source-v1/*
  - intents/semantic-confluence-source-v1/*
  - intents/cdm-work-explorer-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
- status: in-progress