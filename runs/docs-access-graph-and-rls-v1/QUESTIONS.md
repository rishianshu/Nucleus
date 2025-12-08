## Blockers / Clarifications

- How should `cdm_doc_access` be migrated/applied? There is no existing migration path for CDM sinks in this repo. Do we add a SQL migration (and where), or is the table provisioned externally?
- What is the preferred path to upsert KB edges from ACL ingestion? The runtime ingestion (cdm sink) currently writes to Postgres only; MetadataStore graph upserts are available in metadata-api, but the sink does not have a graph client in the ingestion runtime. Should we:
  1) extend the cdm sink to call MetadataStore.upsertGraphEdge for `cdm.doc.access`, or
  2) add a post-processing job in metadata-api to mirror `cdm_doc_access` into KB edges?
- For resolver tests, should we seed `cdm_doc_access` via the CDM sink or via fixtures? No existing harness covers doc access filtering.

## Resolutions (from AGENT_CHATGPT)

- Migrations: add `cdm_doc_access` via the existing metadata-api/CDM migration mechanism (SQL/Prisma alongside other CDM tables). Not externally provisioned.
- KB edges: for this slug, `cdm_doc_access` is the canonical ACL/RLS index. Ingestion writes only to `cdm_doc_access`; do not call GraphStore from the Python ingestion runtime. RLS/UI read from `cdm_doc_access`. Mirroring into KB edges is deferred to a later slug.
- Resolver tests: seed `cdm_doc_access` directly via fixtures for GraphQL/RLS tests. Ingestion/CDM sink tests separately assert that ACL ingestion writes expected rows; do not couple ingestion into resolver test harness.
