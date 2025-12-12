title: Brain Vector Index Foundation v1
slug: brain-vector-index-foundation-v1
type: feature
context: >
  Nucleus now has a unified Knowledge Graph (KG) with CDM entities and Signals
  projected into it via a meta registry and GraphWrite API. The next step for the
  Brain/Workspace is a vector index that can embed and retrieve nodes (work items,
  docs, code, etc.) with consistent metadata keys, keyed by KG node IDs, so that
  GraphRAG and clustering can reuse the same index.

why_now: >
  Without a first-class vector index, we cannot build Brain API, graph+vector
  clustering, or rich retrieval for Workspace. We need a shared concept of "index
  profiles" (what to embed and how), a vector store keyed by KG node IDs, and a
  query API that supports metadata filters (tenant, projectKey, profile) and
  returns node IDs back into the KG.

scope_in:
  - Define an "index profile" abstraction (which nodeTypes to index, which text
    fields from KG/CDM, embedding model id, chunking rules).
  - Add a vector index store (backed by Postgres+pgvector or equivalent) that
    stores embeddings keyed by KG nodeId + profileId + chunkId, plus normalized
    metadata (tenant, projectKey, profileKind).
  - Provide an internal API to:
    - schedule/index nodes for one or more profiles,
    - query the index with a text query and optional metadata filters,
    - return scored nodeId hits for GraphRAG/Brain.
  - Seed at least two profiles: e.g., "work.summary" (cdm.work.item) and
    "doc.body" (cdm.doc.item / cdm.doc.generic) using a normalized metadata schema.

scope_out:
  - No clustering or Brain API logic yet; this slug is only index profiles +
    storage + query API.
  - No UI surfaces; using the API in tests is sufficient.
  - No live streaming/indexing from events; index refresh can be invoked in batch
    from tests.

acceptance:
  1. Index profiles can be defined, listed, and validated at runtime.
  2. A batch indexer can embed CDM work/doc nodes into the vector store for at
     least the seeded profiles.
  3. A query API can run similarity search with metadata filters and return
     scored nodeIds.
  4. The index uses normalized metadata keys (e.g., tenantId, projectKey,
     profileKind) so that different sources (Confluence/OneDrive, Jira, etc.)
     can be queried consistently.

constraints:
  - Vector index must be keyed by KG nodeId + profileId; no parallel identity
    scheme.
  - Metadata shape must be source-agnostic: for example, projectKey rather than
    Jira-specific keys; we can also store raw/source keys in a separate field.
  - Index operations and tests must remain within existing `pnpm ci-check`
    runtime budgets.

non_negotiables:
  - Do not introduce another ad-hoc vector store; reuse Postgres+pgvector or an
    equivalent existing pattern, and keep it behind a clear abstraction.
  - Do not bypass the KG identity model; all indexed items must be resolvable
    back to KG nodes via nodeId.
  - Do not bake Workspace/Inbox semantics into the index; profiles and filters
    must stay app-agnostic.

refs:
  - intents/kg-meta-registry-and-write-api-v1/*
  - intents/kg-cdm-and-signals-bridge-v1/*
  - docs/meta/nucleus-architecture/kb-meta-registry*.md (if present)
  - apps/metadata-api/src/cdm/*
  - apps/metadata-api/src/graph/*
  - any existing pgvector/embedding utility modules

status: ready
