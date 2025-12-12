# SPEC — Brain Episodes Read API v1

## Problem

We now have:

- CDM work/doc entities and Signal instances projected into the KG,
- kg.cluster nodes and IN_CLUSTER edges via ClusterBuilder,
- a vector index and Brain primitives.

But there is no stable, app-facing way to *read* episodes. Workspace and other
clients should not query GraphStore directly or reimplement clustering logic.
They need a simple Brain API to:

- list episodes for a project,
- inspect a single episode (members, signals, basic stats).

Without this, the Brain is not usable as an API surface and every client would
implement its own graph queries.

## Interfaces / Contracts

### 1. GraphQL (or Brain service) schema

We define a Brain-centric read surface in metadata-api’s GraphQL schema. Names
are indicative; adapt to the existing schema conventions.

#### Types

```graphql
type BrainEpisodeMember {
  nodeId: ID!
  nodeType: String!
  entityKind: String!
  cdmModelId: String
  title: String
  summary: String
  projectKey: String
  docUrl: String
  workKey: String
}

type BrainEpisodeSignal {
  id: ID!
  severity: String!
  status: String!
  summary: String!
  definitionSlug: String!
}

type BrainEpisode {
  id: ID!
  tenantId: String!
  projectKey: String!
  clusterKind: String!
  size: Int!
  createdAt: String!
  updatedAt: String!
  windowStart: String
  windowEnd: String
  summary: String
  members: [BrainEpisodeMember!]!
  signals: [BrainEpisodeSignal!]!
}
```

#### Queries

```graphql
type BrainEpisodesConnection {
  nodes: [BrainEpisode!]!
  totalCount: Int!
}

extend type Query {
  brainEpisodes(
    tenantId: String!
    projectKey: String!
    windowStart: String
    windowEnd: String
    limit: Int = 20
    offset: Int = 0
  ): BrainEpisodesConnection!

  brainEpisode(
    tenantId: String!
    projectKey: String!
    id: ID!
  ): BrainEpisode
}
```

Notes:

* `tenantId` is required and must be enforced at the resolver level.
* `projectKey` scopes episodes within a project.
* `windowStart/windowEnd` are optional filter hints (applied to cluster node
  properties where available).
* `limit/offset` provide basic pagination; we don’t need cursor-based paging
  for v1.

### 2. Resolvers

We implement resolvers backed by existing ClusterRead and KG/Signal stores:

```ts
// Pseudocode / shape
async function brainEpisodes(parent, args, ctx): Promise<BrainEpisodesConnection> {
  const { tenantId, projectKey, windowStart, windowEnd, limit, offset } = args;
  // 1) AuthZ: check that caller is allowed to see this tenant/project.
  // 2) Use ClusterRead.listClustersForProject with window filters.
  // 3) Apply limit/offset in memory or via query layer.
  // 4) For each cluster node:
  //    - load members (member nodeIds)
  //    - load minimal member info (via KG/CDM helpers)
  //    - load signal instances attached via HAS_SIGNAL edges or signal store
  // 5) Return BrainEpisodesConnection.
}

async function brainEpisode(parent, args, ctx): Promise<BrainEpisode | null> {
  const { tenantId, projectKey, id } = args;
  // 1) AuthZ on tenant/project.
  // 2) Load cluster node by nodeId from KG; verify tenantId and projectKey match.
  // 3) Derive BrainEpisode shape as in brainEpisodes for this one cluster.
}
```

### 3. Member and Signal mapping

Members:

* Start from `ClusterRead` memberNodeIds.

* For each nodeId, use KG/CDM to resolve:

  * nodeType (e.g., "cdm.work.item", "cdm.doc.item"),
  * core display fields:

    * for work: workKey (issue key), summary, projectKey, title, etc.
    * for doc: title, projectKey/spaceKey normalized, docUrl.

* Map to `BrainEpisodeMember`.

Signals:

* Either:

  * follow HAS_SIGNAL edges in KG to signal.instance nodes, then hydrate from
    signal store, or
  * query the signal store for instances whose entityRef corresponds to member
    node refs.

* Map to `BrainEpisodeSignal` with severity, status, summary, and definitionSlug.

## Data & State

### Source of truth

* Clusters: KG nodes of type "kg.cluster" + IN_CLUSTER edges.
* Members: KD/CDM nodes referenced by IN_CLUSTER.
* Signals: signal store / signal.instance nodes.

### Idempotency

* The Brain read API is pure read; it must not mutate KG/CDM/Signals.
* Repeated calls with the same args return consistent results reflecting the
  current KG state (including any updated clusters).

## Constraints

* Tenant and project scoping:

  * All resolvers must filter on tenantId and projectKey and verify that the
    target cluster node properties match those values. No cross-tenant leakage.
* Performance:

  * Queries in tests should run on small seeded datasets.
  * Implementation should batch lookups where possible (e.g., fetch all member
    node details in one call).

## Acceptance Mapping

* AC1 → Episodes list API

  * Implemented via `brainEpisodes` resolver and cluster listing logic.

* AC2 → Episode detail API

  * Implemented via `brainEpisode` resolver and hydration of members/signals.

* AC3 → Access control and scoping

  * Enforced in resolvers; tested by seeding multiple tenants/projects and
    asserting isolation.

* AC4 → Consistency with KG data

  * Verified by tests that compare Brain API results to direct KG/ClusterRead
    queries for the same clusters.

## Risks / Open Questions

* R1: Over-fetching members/signals

  * Risk: naive implementation may N+1 query KG/Signals.
  * Mitigation: tests run on small data; future slugs can optimize via batching.

* Q1: Should we support multiple clusterKinds in v1?

  * For now, we can keep clusterKind as a property and return all; Workspace
    can filter if needed. Future slugs can add filters for clusterKind.
