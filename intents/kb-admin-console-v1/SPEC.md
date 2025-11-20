## `intents/kb-admin-console-v1/SPEC.md`

````markdown
# SPEC — Knowledge Base Admin Console v1

## Problem
Admins lack a dedicated place to explore and validate the Knowledge Base. Graph identities now exist, but visibility is siloed. We need a first-class KB section to inspect nodes/edges, view scenes, and audit scope/identity/provenance using the same UX/data-loading patterns as Catalog.

## Interfaces / Contracts

### A) Navigation
- Add top-level menu: **Knowledge Base**
  - Subroutes:
    - `/kb/overview`
    - `/kb/explorer/nodes`
    - `/kb/explorer/edges`
    - `/kb/scenes`
    - `/kb/provenance` (contextual; also a tab within Node side panel)
- Existing "Graph identities" list under Endpoints becomes a link: “Open in Knowledge Base”.

### B) GraphQL (additive; scope-filtered by default)
```graphql
# Nodes listing (cursor paginated)
query KbNodes($type: String, $scope: ScopeInput, $search: String, $first: Int, $after: String) {
  kbNodes(type:$type, scope:$scope, search:$search, first:$first, after:$after) {
    edges { node { id type display propsPreview identity { logicalKey originEndpointId originVendor } scope { orgId domainId projectId teamId } updatedAt } }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}

# Edges listing
query KbEdges($edgeType: String, $scope: ScopeInput, $sourceId: ID, $targetId: ID, $first: Int, $after: String) { ... }

# Node details
query KbNode($id: ID!) {
  kbNode(id:$id) {
    id type display props identity { logicalKey externalId originEndpointId originVendor } scope { orgId domainId projectId teamId } provenance phase updatedAt
  }
}

# Neighborhood (N-hop)
query KbNeighbors($id: ID!, $edgeTypes: [String!], $depth: Int!, $limit: Int) { ... }

# Scene (bounded subgraph + summary)
query KbScene($id: ID!, $edgeTypes: [String!], $depth: Int!, $limit: Int) {
  kbScene(...) {
    nodes { id type display }
    edges { id edgeType srcId dstId }
    summary { nodeCount edgeCount truncated }
  }
}
````

* **ScopeInput** mirrors org/domain/project/team.
* All queries are additive; no breaking changes elsewhere.

### C) UI Views & States (ADR-aligned)

* **Overview**: cards with counts by type/scope, “recent changes” (last 24h).
* **Nodes Explorer**:

  * Toolbar: Type select, Scope combo (org/domain/project/team), Search (debounced).
  * Table: columns = Type, Display, Scope (chips), Updated, Identity (copy button).
  * Row click → Side Panel:

    * Identity: logicalKey, origin (endpoint/vendor), externalId (pretty-printed)
    * Scope: org/domain/project/team
    * Provenance: phase, revision, run/signal references
    * Actions: “Open in Dataset/Endpoint/Doc/WorkItem” (when resolvable)
* **Edges Explorer**:

  * Toolbar: Edge type select, Scope combo, filters for Source/Target
  * Table: Edge type, Source (chip), Target (chip), Scope, Updated
* **Scenes**:

  * Input: Node selector (by id/type/search), Depth (1–3), Edge-type allowlist
  * Graph canvas + synchronized list; hard caps (e.g., ≤ 300 nodes / ≤ 600 edges)
* **Provenance**:

  * For selected node: table of last N writes (ts, phase, action, source endpoint, run/signal id)

### D) Action & Loading Patterns

* Use ADR-UI and ADR-Data-Loading:

  * Loading skeletons; empty states; error banners + retry
  * Debounced search; cursor pagination; reset pagination on filter changes
  * Copy-to-clipboard for identity/logicalKey with toast feedback
* No destructive actions in v1.

## Data & State

* No DB schema changes.
* New GraphQL resolvers for queries above (additive).
* Client state per view: filters, pageInfo, selection, loading/error states.

## Constraints

* p95 < 2s at 10k nodes/org for Explorer queries; scenes truncated when limits hit.
* Additive only; RBAC-enforced scope filtering.
* Reuse shared hooks (`usePagedQuery`, `useAsyncAction`) to match Catalog UX.  

## Acceptance Mapping

* AC1 → Nav shows “Knowledge Base”; Endpoints “Graph identities” links to KB.
* AC2 → Nodes Explorer: pagination + filters + side panel with identity/scope/provenance.
* AC3 → Edges Explorer: pagination + filters; node chip deep-links.
* AC4 → Scenes: bounded neighborhood with list sync and caps.
* AC5 → Provenance: last N writes with phase/provenance.
* AC6 → ADR patterns honored (loading/error/empty; debounced search; cursor pagination; feedback toasts). 

## Risks / Open Questions

* Very large orgs may hit scene caps; provide clear truncation messaging.
* Provenance sources vary; start with stored provenance fields; expand later to Signals/Runs timelines.

````

---

