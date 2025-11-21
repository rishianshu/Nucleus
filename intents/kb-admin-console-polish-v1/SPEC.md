# SPEC — KB Admin Console — UX Polish v1

## Problem
Admins can browse but the experience is list‑only, filter UX isn’t derived from data, type labels/values don’t align, re-queries flicker, and copy actions lack feedback. We need a graph‑first toggle, facet filters, label/value alignment, no‑flicker loading, and copy confirmation—consistent with our ADRs.

## Interfaces / Contracts

### 1) GraphQL (additive)

**Facets (new)**
```graphql
query KbFacets($scope: ScopeInput){
  kbFacets(scope:$scope){
    nodeTypes{ value label count }
    edgeTypes{ value label count }
    projects{ value label count }
    domains{ value label count }
    teams{ value label count }
  }
}
````

* Values are canonical (e.g., `catalog.dataset`, `DOCUMENTED_BY`).
* Labels are humanized (“Datasets”, “Documented by”).

> Existing `kbNodes/kbEdges/kbScene` remain unchanged and respect scope by default.

### 2) UI behaviors

**A. Graph toggle (Nodes & Edges)**

* Tabs: **List | Graph**.
* Graph uses **SVG + d3-force** (or equivalent) with `requestAnimationFrame`.
* Caps: ≤ 300 nodes / ≤ 600 edges; show truncation notice and disable physics when capped.

**B. Faceted filters**

* Replace free‑text boxes for type/edgeType/project/domain/team with **combos populated from `kbFacets`**.
* Multi-select allowed where sensible (types/edgeTypes).
* Free‑text search remains (debounced) for regex/partial.

**C. Label/value alignment**

* Introduce a shared mapping util `resolveKbLabel(value) / resolveKbValue(label)`.
* Apply mapping in filter UI and table chips to prevent “Datasets” vs `catalog.dataset` mismatch.

**D. No‑flicker data loading**

* Debounce search 250–400 ms.
* Keep previous data during refetch (e.g., `keepPreviousData=true` or cache‑first with network status flag).
* Preserve **selection** and **scroll position** on refetch.
* Show lightweight **row skeletons** rather than clearing the table. (Follow ADR-Data-Loading.) 

**E. Copy confirmation**

* On copy of `logicalKey`/`uid`, do:

  1. `navigator.clipboard.writeText(key)`
  2. swap icon to ✓ and label to “Copied”
  3. toast “Logical key copied”
  4. revert after 1.5s
  5. ARIA `role="status"` live region message “Copied”

**F. Scenes polish**

* When backend indicates truncation (e.g., `summary.truncated=true`), show a persistent banner.
* Animate node placement on initial render/update (ease‑out), not on every frame to reduce jank.

## Data & State

* No DB changes.
* New `kbFacets` query; cached for 15–30 min.
* Client state: `viewMode (list|graph)`, `facets`, `selected`, `pageInfo`, `loading`.

## Constraints

* Additive GraphQL only.
* Graph remains bounded; no global loads.
* Maintain ADR‑UI & ADR‑Data‑Loading (toasts, skeletons, debounced search, cursor pagination).

## Acceptance Mapping

* AC1 → Facets appear and emit canonical values; labels human-friendly.
* AC2 → No flicker during refetch; previous data visible; selection preserved.
* AC3 → Copy shows ✓ + toast + ARIA; reverts automatically.
* AC4 → Graph view renders current filtered set with animated layout; toggling preserves filters/selection.
* AC5 → Scenes banner appears when capped; layout animates on render/update.
* AC6 → ADR patterns verified (debounce, cursor pagination, loading/error/empty states).

## Risks / Open Questions

* Facet counts for very large orgs: compute via partial aggregations; acceptable to omit counts initially.
* Graph rendering on low‑end devices: auto‑disable physics if FPS < 30 for >1s.


