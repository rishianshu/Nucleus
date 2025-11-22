## `intents/kb-meta-registry-v1/SPEC.md`

````markdown
# SPEC — Knowledge Base Meta Registry v1

## Problem
Type labels and behavior are scattered in UI code, leading to mismatches (“Datasets” vs `catalog.dataset`) and inconsistent labels in Scenes/Edges. We need a single, cacheable registry that provides labels, synonyms, and view hints for each node/edge type.

## Interfaces / Contracts

### A) GraphQL (additive, read-only)
```graphql
type KbNodeType {
  value: String!        # canonical type (e.g., "catalog.dataset")
  label: String!        # human label ("Datasets")
  description: String
  synonyms: [String!]!  # e.g., ["table","tables"]
  icon: String          # optional icon name
  fieldsDisplay: [String!]! # recommended props to surface
  actions: [String!]!   # safe actions, e.g., ["openDataset","openEndpoint","openDoc"]
}

type KbEdgeType {
  value: String!        # e.g., "DOCUMENTED_BY"
  label: String!        # "Documented by"
  description: String
  synonyms: [String!]!
  icon: String
  actions: [String!]!
}

type KbMeta {
  nodeTypes: [KbNodeType!]!
  edgeTypes: [KbEdgeType!]!
  version: String!
}

input ScopeInput { orgId: String!, domainId: String, projectId: String, teamId: String }

type Query {
  kbMeta(scope: ScopeInput): KbMeta!
}
````

* **Scope behavior**: Meta‑KB resolves as `global defaults` overlaid by `per-scope` entries (org/domain/project/team). Missing keys fall back to defaults.

### B) Storage

* Start with a **bundled JSON** default (e.g., `docs/meta/kb-meta.defaults.json`) loaded into memory with a 15‑minute refresh.
* Optional persistence table (future): `kb_meta_registry(scope_hash, type_kind, value, json, updated_at)`, but **not required** in v1.

### C) Console integration

* **Facets**: Replace hard-coded label/value pairs with `kbMeta.nodeTypes`/`edgeTypes`.
* **Search**: Expand a user’s search text using `synonyms` to widen matches (client‑side).
* **Scenes/Edges**: Render humanized edge labels; chips display `label` and copy the canonical `value` when needed.
* **Fallback**: If `kbMeta` fails, show canonical values; filters remain functional.

## Data & State

* No GraphStore schema changes.
* Cache: in‑memory with TTL; ETag‑style `version` to let the console reuse responses.

## Constraints

* Additive only; zero downtime.
* Keep page p95 < 2 s end‑to‑end with cached kbMeta.
* Respect console ADRs (loading states, toasts, no flicker). 

## Acceptance Mapping

* AC1 → Presence of required types in kbMeta.
* AC2 → Nodes filter uses label but submits canonical value.
* AC3 → kbFacets shows labels from kbMeta.
* AC4 → Scenes/Edges render humanized labels.
* AC5 → Synonym search narrows datasets for the mapped type.
* AC6 → Fallback to canonical values when kbMeta is temporarily unavailable.

## Risks / Open Questions

* Very large per-scope registries: we will keep v1 read-only and small; editing UI comes later.
* Conflicting overrides: last‑writer wins by specific scope (team > project > domain > org > global).

````

---

