- title: Metadata & graph identity hardening (record keys, entity IDs)
- slug: metadata-identity-hardening
- type: techdebt
- context:
  - apps/metadata-api/src/temporal/activities.ts (persistCatalogRecords, syncRecordToGraph)
  - MetadataStore / GraphStore implementations in @metadata/core
  - Prisma models for metadata records and any graph-related tables (if persisted)
- why_now: Today MetadataStore and GraphStore often target the same record/entity using naive identities (e.g. simple table names or random UUIDs). As a result, repeated collections and multiple endpoints with similar table names can overwrite each other or produce unstable identities. We need a clear, stable identity scheme for metadata records and graph entities so that Nucleus behaves like a robust “brain” instead of a best-effort cache.
- scope_in:
  - Audit all call sites where MetadataStore `upsertRecord` and GraphStore `upsertEntity` are used (starting with `persistCatalogRecords` and `syncRecordToGraph`).
  - Define a **canonical identity scheme** for:
    - Metadata records (e.g. catalog datasets) – stable, deterministic `id`.
    - Graph entities – stable `(entityType, id)` and `canonicalPath`.
  - Implement ID derivation logic for catalog datasets using endpoint + schema + table (and optional sourceId), so two endpoints with the same table name never collide.
  - Update `persistCatalogRecords` to:
    - derive deterministic record IDs when possible,
    - avoid random UUIDs for primary identity,
    - pass stable IDs into MetadataStore.
  - Update `syncRecordToGraph` to:
    - derive graph entity ID/canonicalPath from the same canonical identity,
    - avoid relying on ambiguous names like simple table names.
  - Keep MetadataStore and GraphStore responsibilities separated:
    - MetadataStore: owns record-level identity.
    - GraphStore: uses stable IDs from metadata + domain-specific keys.
- scope_out:
  - Full-blown multi-tenant graph sharding (future work).
  - Advanced lineage modeling or schema inference (handled by separate slugs).
  - UI changes beyond what is needed to verify identity behavior (Catalog UI should continue to work).
- acceptance:
  1. Two endpoints with the same table name produce distinct metadata records and graph entities that no longer overwrite each other.
  2. Re-running collection for the same endpoint + table updates the existing record/entity instead of creating duplicates or changing identity.
  3. Existing records are either migrated or remain intact; new identity scheme does not break Catalog or graph queries.
  4. MetadataStore and GraphStore APIs are used in a clearly separated way; no direct GraphStore writes via ad-hoc IDs in ingestion code.
- constraints:
  - No breaking changes to GraphQL API shapes (dataset queries must continue to work).
  - Minimal/controlled data migration; if a migration is needed, it must be idempotent and safe to re-run.
  - No secrets or connection details in IDs (IDs must be derived from safe components).
  - `make ci-check` remains < 8 minutes.
- non_negotiables:
  - Identity collisions between endpoints or schemas must be impossible under the new scheme.
  - Repeated collections must not create orphan or duplicate graph entities for the same dataset.
  - Changes must be backward compatible enough that Workspace and existing consumers can continue to function without code changes.
- refs:
  - apps/metadata-api/src/temporal/activities.ts (persistCatalogRecords, syncRecordToGraph)
  - Existing domain `catalog.dataset` and any graph.entity domains using the same IDs
- status: in-progress


⸻

