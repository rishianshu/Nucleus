title: Brain Search GraphRAG API v1
slug: brain-search-graphrag-api-v1
type: feature
context: >
  Nucleus now has a unified KG (CDM + Signals projected into KG), a vector index
  foundation keyed by KG nodeId, and clusters/episodes (kg.cluster + IN_CLUSTER).
  We need a Brain search API that combines vector retrieval + graph expansion into
  a deterministic GraphRAG "context pack" that Workspace can consume to power
  inbox-style resolution and agent prompts without requiring clients to query KG,
  vector index, and signals separately.

why_now: >
  This is the missing API layer that makes the Brain usable from Workspace. With
  GraphRAG search in place, we can validate end-to-end AI retrieval over real data
  (CDM + KG + vector index + clusters + signals). Once this is complete, we can
  pause and then revisit ingestion/UCL for scale and completeness.

scope_in:
  - Add a read-only Brain search API (GraphQL) to run:
    - queryText → embedding → vector search (across selected profiles),
    - graph expansion around top hits (neighbors via KG edges),
    - optional episode scoring using existing cluster membership (IN_CLUSTER),
    - return a deterministic GraphRAG context pack (nodes, edges, passages,
      citations) for downstream LLM use.
  - Support normalized filter keys:
    - tenantId (required),
    - projectKey (optional but first-class),
    - profileKindIn (optional: work/doc/code/etc),
    - secured flag (default true; if unsupported, must degrade safely).
  - Provide a "promptPack" builder output (string/structured) that Workspace can
    feed to an LLM (no LLM call inside this slug).

scope_out:
  - No LLM invocation or answer generation in metadata-api.
  - No new ingestion, endpoint, or UCL work in this slug.
  - No new clustering algorithms; we only reuse existing clusters/episodes if present.
  - No UI work beyond tests; the API must be testable headlessly.

acceptance:
  1. BrainSearch GraphQL query returns ranked hits from vector search with normalized filters.
  2. BrainSearch returns a GraphRAG context pack containing expanded KG subgraph (nodes + edges) around hits.
  3. BrainSearch optionally returns episode candidates (kg.cluster) scored from hit membership, consistent with KG.
  4. BrainSearch returns a deterministic promptPack (context + citations) without calling an LLM.

constraints:
  - Must not call external embedding/LLM APIs in tests; use a deterministic embedding provider stub.
  - Must not bypass KG registry/GraphWrite (read-only here) or invent new identity formats.
  - All IDs returned must be resolvable KG nodeIds.
  - Keep pnpm ci-check within current budget.

non_negotiables:
  - Tenant scoping is mandatory (tenantId required).
  - projectKey is treated as a normalized key (Confluence spaceKey, Git repoKey, etc. may map here).
  - No Workspace-specific UX assumptions in the response shape; keep it app-agnostic.

refs:
  - intents/brain-vector-index-foundation-v1/*
  - intents/brain-clusters-and-episodes-v1/*
  - intents/kg-cdm-and-signals-bridge-v1/*
  - intents/signals-surfaces-and-filters-v1/*
  - apps/metadata-api/src/brain/*
  - apps/metadata-api/src/graph/*
  - apps/metadata-api/src/signals/*
  - apps/metadata-api/src/cdm/*

status: ready
