title: KG CDM and Signals Bridge v1
slug: kg-cdm-and-signals-bridge-v1
type: feature
context: >
  Nucleus now has a Knowledge Graph meta registry and GraphWrite API, and a Signals
  engine with DSL-based definitions. CDM tables (work, docs, etc.) and Signal
  instances live in their own stores, but they are not yet consistently projected
  into the KG via GraphWrite. KB currently shows mostly schema/endpoint nodes,
  not the richer CDM+Signal view we want for Brain/Workspace.

why_now: >
  Before we can build clustering, Brain API, or serious KG-based reasoning, we need
  CDM entities (work, docs, etc.) and Signals to actually appear as KG nodes/edges
  according to the registry. With the meta registry and write API in place, the
  missing piece is a bridge that reads CDM/Signals and upserts graph nodes and
  relationships in an idempotent way.

scope_in:
  - Implement a "CDM→KG bridge" in metadata-api that:
    - reads CDM work/doc rows (and optionally other small CDM families if easy),
    - uses GraphWrite.upsertNode/upsertEdge to create/refresh KG nodes and edges
      for those entities.
  - Implement a "Signals→KG bridge" that:
    - reads SignalInstance rows,
    - creates signal.instance nodes and HAS_SIGNAL edges to their target entities
      (work/doc/cluster) via GraphWrite.
  - Provide batch/sync functions (e.g., syncAllCdmToKg, syncSignalsToKg) that can
    be invoked from tests or cron/Temporal later.
  - Ensure both bridges are idempotent and use the node/edge type registry
    (no hard-coded node/edge types outside the registry).

scope_out:
  - No streaming/event wiring in this slug (no Kafka/Temporal subscriptions);
    bridges can be batch/polling style invoked from tests.
  - No new UI views beyond what is required to keep KB tests happy; this work is
    primarily service-level.
  - No clustering logic or Brain API logic; those will build on the populated KG.

acceptance:
  1. CDM work/doc entities can be projected into KG nodes and edges via GraphWrite.
  2. Signal instances can be projected into KG as nodes and HAS_SIGNAL edges pointing
     at their target entities.
  3. The bridge functions are idempotent: re-running them does not create duplicate
     nodes/edges.
  4. Existing KG/KB read helpers can query at least one CDM entity and its attached
     Signals from the KG after the bridge runs.

constraints:
  - Bridges must call GraphWrite and respect the kg_node_types/kg_edge_types
    registry; no direct, ad-hoc writes into GraphStore.
  - Sync functions must operate in pages/batches to avoid loading all rows at once.
  - `pnpm ci-check` runtime must stay within the existing budget.

non_negotiables:
  - Do not introduce new node/edge types in this slug beyond what the meta registry
    already seeds (or clearly extend in a separate migration file).
  - Do not bypass the registry or GraphWrite; all new KG nodes/edges from CDM/Signals
    go through the standard write path.
  - Do not break existing KB admin console functionality or KG-related tests.

refs:
  - intents/kg-meta-registry-and-write-api-v1/*
  - apps/metadata-api/src/graph/*
  - apps/metadata-api/src/cdm/*
  - apps/metadata-api/src/signals/*
  - docs/meta/nucleus-architecture/kb-meta-registry*.md (if present)

status: ready
