- title: Knowledge Base Admin Console v1 (Explorer, Scenes, Provenance)
- slug: kb-admin-console-v1
- type: feature
- context:
  - apps/metadata-console (left nav; new "Knowledge Base" section)
  - GraphStore (Postgres-backed kb_node/kb_edge with scope+identity)
  - apps/metadata-api GraphQL (additive queries for nodes/edges/scene)
  - ADR-UI & ADR-Data-Loading patterns
- why_now: Graph identities and scoped logical keys are live, but visibility lives in a small list under Endpoints. Admins need a dedicated KB hub to explore nodes/edges, inspect scope/identity/provenance, view scenes, and deep-link to related assets. This is foundational for agentic Sidekick later and de-risks semantic source rollouts.
- scope_in:
  - Add a **top-level "Knowledge Base"** menu with sub-pages:
    1) **Overview**: counts by type/scope; recent changes.
    2) **Explorer • Nodes**: paginated, filterable by type/scope/search; side panel shows identity/scope/provenance; “Open in …” actions.
    3) **Explorer • Edges**: paginated, filterable by edge type/scope/source/target; side panel with identity/provenance.
    4) **Scenes**: N-hop neighborhood viewer for a selected node (edge-type filters).
    5) **Provenance**: recent writes affecting a selected node (signals/runs summary).
  - GraphQL (additive): `kbNodes`, `kbEdges`, `kbNode`, `kbNeighbors`, `kbScene` (cursor paginated; scope-filtered).
  - Console behaviors follow ADR-UI (action states/toasts) and ADR-Data-Loading (debounced search, cursor pagination, reset on filter changes).
- scope_out:
  - Destructive edits (merge/split), HITL curation queue, vector graph alignment, policy editing (separate slugs).
- acceptance:
  1. New top-level **Knowledge Base** menu appears; “Graph identities” list is replaced by/linked to KB Explorer.
  2. **Nodes Explorer** lists nodes with server pagination + type/scope/search filters; selecting a row opens a side panel with identity/scope/provenance.
  3. **Edges Explorer** lists edges with type/scope/source/target filters; selecting shows identity/provenance; clicking node chips deep-links to that node in Explorer.
  4. **Scenes** renders a bounded neighborhood (configurable depth, edge-type allowlist) with a tabular list synchronized to the graph; from a node you can “Open in …” (Dataset/Endpoint/Doc/WorkItem).
  5. **Provenance** tab for any selected node shows last N changes (source endpoint, phase, revision, timestamps).
  6. All lists support cursor pagination and follow ADR data-loading (debounced search, reset on filter changes); all async actions show local + global feedback (no silent failures).
- constraints:
  - Additive GraphQL only; scope-filtered reads by default.
  - Performance: p95 < 2s for Explorer queries at 10k nodes/org; scenes capped by max nodes/edges in response.
  - `make ci-check` < 8 minutes.
- non_negotiables:
  - No cross-tenant leakage; queries enforce scope from auth.
  - Show **identity (logicalKey)**, **scope**, and **provenance** for traceability.
- refs:
  - catalog-view-and-ux-v1 SPEC (ADR patterns for UI & loading) :contentReference[oaicite:4]{index=4}
  - catalog-view-bugfixes-v0-1 SPEC/INTENT/RUNCARD (pagination/feedback baselines) :contentReference[oaicite:5]{index=5} :contentReference[oaicite:6]{index=6} :contentReference[oaicite:7]{index=7}
- status: in-progress

