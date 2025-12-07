- title: KB relations and lineage v1 (PK/FK and structural edges)
- slug: kb-relations-and-lineage-v1
- type: feature
- context:
  - apps/metadata-api/src/schema.ts (KB + catalog resolvers)
  - apps/metadata-api/src/graph/* (GraphStore client, KB persistence)
  - apps/metadata-ui (KB admin console, Catalog dataset/table/column detail)
  - platform/spark-ingestion (JDBC metadata collection + graph emit)
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/kb-meta-registry-v1.md
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- why_now: The Knowledge Base currently knows about entities (datasets, tables, columns, docs, endpoints) but its structural relations are shallow. We want Nucleus to act as a true “brain” that understands how data hangs together: dataset → table → column containment, primary keys, foreign keys, and basic derived-from edges. JDBC metadata already exposes a lot of this; we need to normalize, emit, and surface those relations in KB and UI so downstream agents and humans can traverse them.
- scope_in:
  - Define KB types and edge semantics for:
    - dataset → table → column containment,
    - table/column PKs,
    - table/column FKs (references).
  - Extend JDBC metadata ingestion to extract PK/FK + containment info and emit it into KB via existing GraphStore APIs.
  - Expose structural relations in GraphQL (KB + Catalog resolvers) in a machine-friendly way.
  - Update KB admin console and Catalog dataset/table detail views to show inbound/outbound FK relationships.
- scope_out:
  - Runtime lineage based on query logs or ETL jobs.
  - Non-relational semantics (e.g., Jira Work ↔ docs ↔ tables) beyond simple existing links.
  - Complex impact analysis UX; v1 can show relatively raw relationships.
- acceptance:
  1. KB contains containment (dataset→table→column) and PK/FK edges for seeded JDBC schemas.
  2. Catalog/KB resolvers expose these relations in GraphQL in a structured form.
  3. Dataset/table/column detail UI surfaces inbound/outbound FKs and basic containment.
  4. KB admin console can filter and inspect PK/FK edges for debugging.
  5. Existing ingestion remains incremental and CI (`pnpm ci-check`) stays green.
- constraints:
  - KB schema changes must be additive (no breaking existing node/edge types).
  - Ingestion of relations must be bounded; avoid O(N²) blowups for large schemas.
  - No breaking changes to existing Catalog GraphQL contracts (only additive fields).
- non_negotiables:
  - Relations are derived from source metadata (information_schema/introspection), not guessed heuristics.
  - KB remains the single source of truth for structural relations; UI and agents read from KB, not ad hoc joins.
- refs:
  - intents/catalog-view-and-ux-v1/*
  - intents/kb-admin-console-v1/*
  - intents/metadata-identity-hardening/*
  - intents/ingestion-strategy-unification-v1/*
- status: ready