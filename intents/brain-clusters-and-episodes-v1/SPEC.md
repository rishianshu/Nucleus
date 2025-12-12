# SPEC — Brain Clusters and Episodes v1

## Problem

We want Nucleus (and downstream Workspace) to reason in terms of "problems" or
"episodes" rather than isolated artifacts. A single episode might include:

- one or more work items (tickets/issues),
- related docs (Confluence/OneDrive, design docs, RFCs),
- possibly signals (stale, orphaned, risk flags).

We already have:
- CDM work & doc entities,
- Signals (via the Signals engine),
- a KG with these projected in,
- a vector index that can find semantically similar nodes.

However, there is no first-class concept of a "cluster" or "episode" in the KG.

## Interfaces / Contracts

### 1. Cluster node representation

nodeType: `"kg.cluster"`

Required properties:
- `tenantId` (string)
- `projectKey` (string)
- `clusterKind` (string) — e.g., "work-doc-episode"
- `seedNodeIds` (string[]/json)
- `size` (number)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Optional properties:
- `summary` (string)
- `windowStart` / `windowEnd` (timestamps)
- `score` (number)

Edges:
- edgeType: `"IN_CLUSTER"`
- from_node_type: `*` (cdm.work.item, cdm.doc.item)
- to_node_type: `"kg.cluster"`
- multiplicity: many-to-one

### 2. Cluster/Episode builder

```ts
export interface ClusterBuilder {
  buildClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
    maxSeeds?: number;
    maxClusterSize?: number;
  }): Promise<{ clustersCreated: number; membersLinked: number }>;
}
```

Algorithm (v1):
1. Seed selection: Query KG/CDM for work items in tenant/project/window
2. Per-seed neighbor search: Use BrainVectorSearch for similar nodes
3. Cluster aggregation: Group seed + neighbors above threshold
4. Cluster node creation: GraphWrite.upsertNode with kg.cluster type
5. Edge creation: GraphWrite.upsertEdge with IN_CLUSTER type

### 3. Cluster listing

```ts
export interface ClusterRead {
  listClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
  }): Promise<Array<{
    clusterNodeId: string;
    clusterKind: string;
    memberNodeIds: string[];
  }>>;
}
```

## Data & State

### Storage
- Cluster nodes: KG nodes with nodeType="kg.cluster"
- Membership: IN_CLUSTER edges from member → cluster

### Idempotency
- Deterministic nodeId per (tenantId, projectKey, seedNodeId)
- Upsert behavior for repeated runs

## Acceptance Mapping
- AC1 → kg.cluster node type + IN_CLUSTER edge type via GraphWrite
- AC2 → ClusterBuilder groups seeded work/doc nodes
- AC3 → Idempotency verified by double-run test
- AC4 → ClusterRead retrieves clusters and members
