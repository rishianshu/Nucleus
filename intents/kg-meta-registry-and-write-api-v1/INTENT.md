title: KG Meta Registry and Write API v1
slug: kg-meta-registry-and-write-api-v1
type: feature
context: >
  Nucleus's Knowledge Graph (KG) currently stores node/edge data via ad-hoc code paths
  (KB console, endpoint identities, some metadata), while CDM, Signals, and new
  enrichment outputs (profiles, descriptions, lineage, clusters) mostly live outside
  the KG. We need a typed meta-registry and a generic write API so any producer
  (CDM bridge, Signals engine, profiler, agent) can safely post nodes/edges against
  known types without bespoke graph plumbing each time.

why_now: >
  We are moving toward a single KG as the "brain" of Nucleus, with Workspace/Brain API
  consuming clusters and entities from that graph. Before we wire CDM, Signals, and
  future enrichers into the KG, we must define how node/edge types are registered,
  validated, and written. This enables consistent growth of KG (e.g., description and
  profile nodes, lineage edges, clusters) without per-feature graph rewrites.

scope_in:
  - Introduce a node-type meta registry (e.g., KgNodeType) that defines legal node
    types (id, family, required/indexed props) for the KG.
  - Introduce an edge-type meta registry (e.g., KgEdgeType) that defines allowed
    edges (id, fromType, toType, semantics) between node types.
  - Implement a GraphWrite API on top of GraphStore that accepts upsertNode/upsertEdge
    calls, validates them against the registries, and persists to the existing KG
    storage.
  - Seed the registry with a minimal but representative set of node/edge types,
    including at least: cdm.work.item, cdm.doc.item, column.description, column.profile,
    signal.instance, kg.cluster, and edges like DESCRIBES, PROFILE_OF, HAS_SIGNAL,
    IN_CLUSTER.
  - Add tests that show a non-CDM/non-Signal producer (e.g., a profiler creating a
    column.profile node) can publish nodes/edges via GraphWrite and that these
    appear in KG queries.

scope_out:
  - No event-consumer wiring in this slug (no CDM/Signals-to-KG subscription); those
    will be added in follow-up slugs once the registry and write API are stable.
  - No Brain API or Workspace Inbox semantics; this is infra for KG, not UX.
  - No new KB admin console screens beyond what's required to keep existing KB tests
    passing; light adjustments to show new node types are acceptable but optional.

acceptance:
  1. Node types are defined in a meta registry and enforced by GraphWrite.upsertNode.
  2. Edge types are defined in a meta registry and enforced by GraphWrite.upsertEdge.
  3. GraphWrite successfully persists valid nodes/edges into GraphStore with idempotent semantics.
  4. At least one new enrichment node type (e.g., column.profile and column.description)
     can be created via GraphWrite and is queryable through existing KG/KB read APIs.

constraints:
  - Registries must be queryable at runtime (no compile-time-only constants), so new
    node/edge types can be added via migrations/seeded data without code changes.
  - GraphWrite must validate type IDs against the registries and fail-closed on
    unknown node/edge types or missing required properties.
  - Changes must not break existing KG/KB behavior or inflate `pnpm ci-check` beyond
    current runtime budgets.

non_negotiables:
  - Do not introduce a second graph store; all writes go through the existing GraphStore
    backing used by the KB console.
  - Do not hard-code Workspace/Inbox semantics into node types or edge types; the KG
    must remain app-agnostic.
  - Do not remove or rename existing node/edge identifiers in ways that break current
    KB explorers or tests.

refs:
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/kb-meta-registry*.md (if present)
  - apps/metadata-api/src/graphStore/*
  - apps/metadata-api/src/signals/*
  - apps/metadata-api/src/cdm/*

status: ready
