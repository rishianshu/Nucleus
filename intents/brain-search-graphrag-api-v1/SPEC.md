# SPEC — Brain Search GraphRAG API v1

## Problem

We have the "data plane" for the Brain:
- KG nodes/edges (CDM + Signals bridged into KG),
- vector index keyed by KG nodeId,
- clusters/episodes as kg.cluster nodes.

But we do not have a single API that:
1) retrieves relevant entities by semantic similarity,
2) expands context using the KG,
3) optionally groups results via episodes,
4) returns a deterministic pack that downstream apps can feed into an LLM.

Without this, Workspace must stitch together vector queries, KG queries, signals,
and clusters manually, which defeats the "Nucleus is the brain" goal.

## Interfaces / Contracts

### GraphQL Query: brainSearch

Add a GraphQL query (names are indicative; keep consistent with existing schema):

```graphql
input BrainSearchFilterInput {
  tenantId: String!
  projectKey: String
  profileKindIn: [String!]
  secured: Boolean = true
}

input BrainSearchOptionsInput {
  topK: Int = 20
  maxEpisodes: Int = 10
  expandDepth: Int = 1
  maxNodes: Int = 200
  includeEpisodes: Boolean = true
  includeSignals: Boolean = true
  includeClusters: Boolean = true
}

type BrainSearchHit {
  nodeId: ID!
  nodeType: String!
  profileId: String!
  profileKind: String!
  score: Float!
  title: String
  url: String
}

type BrainGraphNode {
  nodeId: ID!
  nodeType: String!
  label: String
  properties: JSON
}

type BrainGraphEdge {
  edgeType: String!
  fromNodeId: ID!
  toNodeId: ID!
  properties: JSON
}

type BrainSearchEpisode {
  clusterNodeId: ID!
  clusterKind: String!
  projectKey: String!
  score: Float!
  size: Int!
  memberNodeIds: [ID!]!
}

type BrainRagPassage {
  sourceNodeId: ID!
  sourceKind: String!
  text: String!
  url: String
}

type BrainPromptPack {
  contextMarkdown: String!
  citations: JSON!
}

type BrainSearchResult {
  hits: [BrainSearchHit!]!
  episodes: [BrainSearchEpisode!]!
  graphNodes: [BrainGraphNode!]!
  graphEdges: [BrainGraphEdge!]!
  passages: [BrainRagPassage!]!
  promptPack: BrainPromptPack!
}

extend type Query {
  brainSearch(
    queryText: String!
    filter: BrainSearchFilterInput!
    options: BrainSearchOptionsInput
  ): BrainSearchResult!
}
```

### Deterministic behavior (GraphRAG)

Pipeline (deterministic, no LLM):

1. **Embed queryText**

   * Use the embedding model(s) associated with each profile queried.
   * For v1, allow searching across a default profile set if profileKindIn omitted:

     * work: `cdm.work.summary` (or equivalent),
     * doc: `cdm.doc.body` (or equivalent).

2. **Vector retrieval**

   * Query vector index constrained by normalized metadata:

     * tenantId required,
     * projectKey optional (filter),
     * profileKindIn optional.
   * Return hits: nodeId + profileId + score.

3. **Graph expansion**

   * For each hit nodeId, expand via KG edges up to `expandDepth` (default 1):

     * include:

       * HAS_SIGNAL edges (to signal.instance) if includeSignals,
       * IN_CLUSTER edges (to kg.cluster) if includeClusters,
       * other "safe" adjacency edges that exist in KG registry.
   * Bound expansion by `maxNodes` and deduplicate nodes/edges.

4. **Episode scoring**

   * If includeEpisodes:

     * Identify episode candidates as kg.cluster nodes reachable via IN_CLUSTER from hit nodes.
     * Score each cluster as sum of member hit scores (simple, deterministic).
     * Return top `maxEpisodes` episodes with members.

5. **Passage assembly**

   * For top hits (and optionally top episode members), build short text passages:

     * work item: use CDM summary/title + optional description excerpt if stored,
     * doc item: use title + short body excerpt (bounded, e.g., 1–2k chars).
   * Total passages text length bounded (e.g., <= 30k chars).
   * Passages are labeled with sourceKind: "work" | "doc" | "code" | "other".

6. **Prompt pack**

   * Build `contextMarkdown` in a deterministic format:

     * Query
     * Episodes summary (optional)
     * Top hits with citations
     * Passages with citations
   * `citations` is structured JSON:

     * array of {sourceNodeId, url, title, nodeType}.

### Security / RLS

* `tenantId` is mandatory; resolvers must reject missing tenantId.
* If filter.secured=true:

  * doc retrieval for passages must use secured doc store paths where available.
  * If the request context lacks a principal, fail closed (return authorization error),
    unless the system already has a defined "service principal" mode.

(If the repo currently cannot enforce secured mode end-to-end, implement safe
degradation: secured=true returns only non-secured items; never return secured
items without principal.)

## Data & State

* Read-only; no writes to KG, CDM, or vector index.
* Uses:

  * VectorIndexStore.query (vector retrieval),
  * GraphStore/KG read helpers (graph expansion, clusters),
  * SignalStore (optional hydration),
  * CDM stores for passage text retrieval.

## Constraints

* No external network calls in tests:

  * embedder must be deterministic fake in test environment.
* Avoid N+1 queries:

  * batch fetch nodes/edges where possible.
* Maintain response size bounds:

  * maxNodes, bounded passages, bounded citations.

## Acceptance Mapping

* AC1 → vector retrieval + filters tested with seeded vectors and nodes
* AC2 → graph expansion returns expected nodes/edges around known hits
* AC3 → episode scoring returns cluster nodes consistent with KG membership
* AC4 → promptPack deterministic shape verified in tests; no LLM calls
