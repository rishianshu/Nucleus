# SPEC — KG Meta Registry and Write API v1

## Problem

The Nucleus Knowledge Graph (KG) is intended to hold not just schemas and endpoints,
but also CDM entities, Signals, profiles, descriptions, lineage, clusters, and
future enrichments. Today, most of that data lives outside the KG (CDM tables,
signal store, separate services), and whatever is in the KG is written through
ad-hoc, type-specific code.

This makes it hard to:
- add new node/edge types (e.g., column.profile, column.description, lineage edges),
- let multiple services (CDM bridge, Signals engine, profilers, agents) publish
  graph knowledge in a consistent way, and
- reason about what types are allowed and how they should be queried.

We need a clear meta-registry for KG node/edge types and a generic, validated
write API so that any producer can post well-typed nodes/edges without bespoke
GraphStore plumbing.

## Interfaces / Contracts

### 1. Node-type registry

We introduce a node-type meta model, persisted in metadata-api (e.g., Postgres),
for example:

- Table: `kg_node_types`
- Fields:
  - `id` (PK, string): unique node type ID, e.g., "cdm.work.item", "cdm.doc.item",
    "column.profile", "column.description", "signal.instance", "kg.cluster".
  - `family` (string): high-level grouping, e.g., "work", "doc", "code", "data",
    "signal", "cluster", "policy", "other".
  - `description` (text): human-readable description.
  - `id_prefix` (string): recommended ID prefix, e.g., "cdm.work.item:", "kg.cluster:".
  - `required_props` (jsonb): array of strings indicating required property keys.
  - `optional_props` (jsonb): array of strings indicating optional property keys.
  - `indexed_props` (jsonb): array of strings indicating which properties should be
    indexed for search/filter.
  - `label_template` (text, nullable): template for display labels (optional).
  - `icon` (string, nullable): optional UI hint.

Example seed rows (non-exhaustive):

- "cdm.work.item" (family "work", required: ["projectKey", "createdAt"])
- "cdm.doc.item" (family "doc")
- "column.profile" (family "data")
- "column.description" (family "data")
- "signal.instance" (family "signal")
- "kg.cluster" (family "cluster")

### 2. Edge-type registry

We introduce an edge-type meta model:

- Table: `kg_edge_types`
- Fields:
  - `id` (PK, string): edge type ID, e.g., "DESCRIBES", "PROFILE_OF", "HAS_SIGNAL",
    "IN_CLUSTER", "BELONGS_TO_PROJECT".
  - `from_node_type` (string, FK to `kg_node_types.id`): source node type.
  - `to_node_type` (string, FK): target node type.
  - `direction` (string): "out", "in", or "both" (mainly for documentation/UI).
  - `description` (text): human-readable description.
  - `multiplicity` (string, nullable): "one-to-one", "one-to-many", "many-to-many".
  - `symmetric` (boolean, default false): whether the edge is symmetric.

Example seed rows:

- DESCRIBES: from "column.description" to "cdm.column"
- PROFILE_OF: from "column.profile" to "cdm.column"
- HAS_SIGNAL: from "cdm.work.item" / "cdm.doc.item" / "kg.cluster" to "signal.instance"
- IN_CLUSTER: from any node type to "kg.cluster"

### 3. GraphWrite API

We define a write interface inside metadata-api (TS) that all producers should use:

```ts
export interface GraphWrite {
  upsertNode(input: {
    nodeType: string;                 // must exist in kg_node_types
    nodeId?: string;                  // optional; GraphStore may allocate if absent
    externalId?: string;              // optional; for mapping to CDM/Signal IDs
    properties: Record<string, unknown>;
  }): Promise<{ nodeId: string }>;

  upsertEdge(input: {
    edgeType: string;                 // must exist in kg_edge_types
    fromNodeId: string;
    toNodeId: string;
    properties?: Record<string, unknown>;
  }): Promise<void>;
}
```

Behavior:
- `upsertNode`:
  - Validates nodeType against kg_node_types.
  - Ensures properties contains all required_props keys.
  - Creates or updates a GraphStore node.
  - Returns the resolved nodeId.
- `upsertEdge`:
  - Validates edgeType against kg_edge_types.
  - Ensures the existing nodes referenced by fromNodeId and toNodeId have
    types compatible with from_node_type / to_node_type.
  - Upserts an edge in GraphStore, avoiding duplicate edges.

Errors:
- Unknown nodeType or edgeType → fail with typed error.
- Missing required property → fail with typed error.
- Node type mismatch for edge → fail with typed error.

### 4. Read compatibility

Existing GraphStore and KB admin read APIs remain unchanged; they simply see more
nodes/edges. For tests, we rely on existing GraphStore queries to verify that
nodes/edges created via GraphWrite are visible.

## Data & State

### Storage
- Node and edge types are stored in metadata-api's Postgres DB in kg_node_types
  and kg_edge_types tables, with migrations to create and seed them.
- KG nodes and edges continue to be stored in existing GraphStore tables.

### Idempotency
- `upsertNode` must be idempotent on (nodeType, nodeId).
- `upsertEdge` must avoid duplicate edges.

### Side-effects
- No external events are emitted in this slug; GraphWrite only affects the KG.
- Existing KB readers will see new node types but should continue to function.

## Constraints
- The node/edge registries must be inspectable for debugging and meta tooling.
- GraphWrite must be internal to metadata-api (TS) and covered by tests.
- Performance: Node and edge upserts should be O(1) per call with standard indexes.

## Acceptance Mapping
- AC1 → Node types are defined and enforced by GraphWrite.upsertNode
- AC2 → Edge types are defined and enforced by GraphWrite.upsertEdge
- AC3 → GraphWrite persists nodes/edges idempotently into GraphStore
- AC4 → Enrichment node types (column.profile/column.description) are writable and queryable

## Risks / Open Questions
- R1: Over-constraining the registry schema
- R2: Edge explosion if we don't index correctly
- Q1: How to manage registry changes across environments? (seed via migrations for now)
