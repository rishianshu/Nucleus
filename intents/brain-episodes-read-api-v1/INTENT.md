title: Brain Episodes Read API v1
slug: brain-episodes-read-api-v1
type: feature
context: >
  Nucleus now builds kg.cluster nodes and IN_CLUSTER edges from CDM + Signals,
  and we have a Brain vector index plus a ClusterBuilder/ClusterRead layer.
  Workspace and other downstream apps need a stable Brain-facing API to fetch
  episodes (clusters) and their members by tenant/project, as well as basic
  per-episode context, instead of doing ad-hoc graph queries.

why_now: >
  Clusters/episodes exist in the KG, but they are only accessible through
  internal helpers and GraphStore queries. To make Nucleus a usable "brain API"
  for Workspace, we need a clear read surface: list episodes for a project,
  inspect one episode (members, signals, docs), and fetch lightweight context
  suitable for inbox-style UX.

scope_in:
  - Add a Brain/episodes read surface in metadata-api (GraphQL or a small
    Brain-specific service layer) to:
    - list episodes (kg.cluster nodes) for a tenant + project + time window,
    - fetch details for a given episode/cluster nodeId (members, basic stats,
      attached signals).
  - Reuse existing ClusterRead + KG/Signals helpers; no new clustering logic.
  - Ensure responses are tenant-safe and project-scoped, with stable IDs and
    a shape that Workspace can consume.

scope_out:
  - No write APIs (no mutation to edit clusters) in this slug.
  - No LLM summarization or narrative fields (we can expose placeholders like
    `summary` if they exist, but not generate them here).
  - No Workspace "Inbox" UX or pagination beyond what the API needs; UI surfaces
    are for a later slug.

acceptance:
  1. A Brain episodes list API exists that returns episodes for a given tenantId,
     projectKey, and optional window.
  2. An episode detail API exists that returns cluster properties, member nodes
     (IDs + basic info), and attached Signals for a given episode ID.
  3. Access control and scoping enforce tenant boundaries and project scoping.
  4. Episodes returned by the Brain API are consistent with the underlying
     kg.cluster + IN_CLUSTER data (no phantom or mismatched episodes).

constraints:
  - API must be read-only and idempotent.
  - API must use existing ClusterRead + KG/Signal stores; no duplicate logic
    for building clusters.
  - Response shapes must be stable and easily mappable to Workspace’s concept
    of "episode cards" without encoding Workspace-specific concerns.

non_negotiables:
  - Do not introduce a second cluster representation; all data comes from KG
    nodes/edges projected via the existing bridge.
  - Do not bypass GraphStore or KG abstractions; Brain read APIs sit on top.
  - Do not weaken tenant isolation: cross-tenant reads must not be possible.

refs:
  - intents/brain-clusters-and-episodes-v1/*
  - intents/kg-cdm-and-signals-bridge-v1/*
  - apps/metadata-api/src/brain/*
  - apps/metadata-api/src/graph/*
  - apps/metadata-api/src/signals/*
  - any existing GraphQL schema files for metadata-api

status: ready
