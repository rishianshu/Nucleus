title: Brain Clusters and Episodes v1
slug: brain-clusters-and-episodes-v1
type: feature
context: >
  Nucleus now has a unified KG (CDM + Signals), a KG meta registry with GraphWrite,
  and a Brain vector index with normalized metadata. Workspace/Inbox and Brain API
  concepts assume there is a notion of "episodes" or "clusters" that group related
  work items, docs, and signals into coherent problem-centric bundles. Today, no
  such cluster nodes exist in the KG; every query still returns flat lists.

why_now: >
  To move from raw entities (issues, docs, signals) to problem-centric views, we
  need a first-class representation of clusters/episodes inside the KG. These
  clusters must be built using both vector similarity (semantic relatedness) and
  KG structure (links, shared project/tenant), and stored as kg.cluster nodes
  with IN_CLUSTER edges. This is the backbone for a Workspace Inbox of "problems"
  and for Brain/GraphRAG context assembly.

scope_in:
  - Define and use a "kg.cluster" node type (leveraging the KG meta registry)
    representing an episode/cluster, with properties such as clusterKind,
    projectKey, tenantId, seedNodeIds, and basic stats (size, updatedAt).
  - Implement a clustering/episode builder that:
    - takes a set of seed nodes (e.g., recent cdm.work.item nodes) in a
      tenant + project,
    - uses the Brain vector index plus simple KG heuristics (shared project,
      doc/work links) to group related work & doc nodes into clusters,
    - writes kg.cluster nodes and IN_CLUSTER edges via GraphWrite.
  - Ensure clustering is idempotent per (tenant, project, time window) so repeated
    runs don't create unbounded duplicate clusters.
  - Expose an internal API to list clusters and their member nodes for a given
    project, to be used later by Brain/Workspace.

scope_out:
  - No Brain API or Workspace Inbox UI in this slug; we only define the cluster
    representation and builder.
  - No advanced algorithms (HNSW graph walks, spectral clustering, etc.); a simple
    threshold/nearest-neighbor approach is acceptable for v1.
  - No cross-tenant clusters or multi-tenant logic; each run operates within a
    single tenant.

acceptance:
  1. kg.cluster node type and IN_CLUSTER edge type are defined in the KG registry
     and used by the cluster builder via GraphWrite.
  2. A clustering/episode builder can group a small set of seeded work + doc nodes
     into one or more clusters using the vector index and project/tenant filters.
  3. Cluster building is idempotent for a given (tenant, project, time window);
     re-running does not create duplicate clusters or duplicate IN_CLUSTER edges.
  4. KG/Brain read helpers can retrieve, for a given work item, its cluster node
     and the other member nodes in that cluster.

constraints:
  - Clustering logic must operate in batches and rely on the existing Brain
    vector index (no bespoke embedding calls inside the cluster alg).
  - All cluster nodes and IN_CLUSTER edges must be written via GraphWrite and
    validated against kg_node_types/kg_edge_types.
  - Clusters must be scoped by tenantId and projectKey in their properties.

non_negotiables:
  - Do not encode Workspace-specific notions (e.g., "ticket triage") into
    cluster types; clusters must be app-agnostic problem bundles.
  - Do not bypass the KG registry or GraphWrite to insert nodes/edges.
  - Do not degrade `pnpm ci-check` significantly; clustering tests must run on
    small seeded graphs only.

refs:
  - intents/kg-meta-registry-and-write-api-v1/*
  - intents/kg-cdm-and-signals-bridge-v1/*
  - intents/brain-vector-index-foundation-v1/*
  - apps/metadata-api/src/graph/*
  - apps/metadata-api/src/brain/*
  - apps/metadata-api/src/signals/*

status: ready
