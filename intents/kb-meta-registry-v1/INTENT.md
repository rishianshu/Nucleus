- title: Knowledge Base Meta Registry v1 (labels, synonyms, templates, actions)
- slug: kb-meta-registry-v1
- type: feature
- context:
  - apps/metadata-api (GraphQL read resolvers)
  - GraphStore (types, scopes, provenance)
  - apps/metadata-console (KB filters, chips, scenes)
  - ADR-UI / ADR-Data-Loading baselines for the console
- why_now: After kb-admin-console-polish-v1, UI still relies on ad-hoc label→value mappings (e.g., “Datasets” vs `catalog.dataset`). A **Meta‑KB** creates a single source of truth for human labels, synonyms, display templates, and allowed actions per node/edge type. It stabilizes facets, search, and Scenes, and sets the stage for Explain/Sidekick.
- scope_in:
  - Introduce **Meta‑KB registry** (defaults + optional per-scope overrides):
    - Node types: `{ value, label, description?, synonyms[], icon?, fieldsDisplay[], actions[] }`
    - Edge types: `{ value, label, description?, synonyms[], icon?, actions[] }`
  - GraphQL (read-only) to fetch registry by scope.
  - Console: use Meta‑KB for **facet labels**, **type chips**, **edge labels** in Scenes, and **search synonyms**.
  - Fallback behavior: when a type is missing, show canonical value but **never break** filters.
- scope_out:
  - Authoring UI (editing registry), Sidekick Explain, vector alignment (separate slugs).
- acceptance:
  1. GraphQL returns Meta‑KB with entries for at least: `catalog.dataset`, `metadata.endpoint`, `doc.page`, `DEPENDENCY_OF`, `DOCUMENTED_BY`.
  2. Nodes “Type” filter shows human labels (e.g., “Datasets”) but applies canonical values (`catalog.dataset`) to queries.
  3. `kbFacets` displays labels from Meta‑KB; selecting options yields correct results.
  4. Scenes/Edges render humanized edge labels (e.g., “Documented by”).
  5. Search using a **synonym** (e.g., “table” → `catalog.dataset`) narrows results.
  6. If Meta‑KB is unreachable, UI falls back to canonical values without errors.
- constraints:
  - Additive GraphQL only; p95 < 200 ms for kbMeta reads (cached).
  - Follow existing console ADRs for data loading/feedback. :contentReference[oaicite:2]{index=2}
- non_negotiables:
  - Canonical values remain stable; mapping is deterministic and testable.
- refs:
  - catalog-view-bugfixes-v0-1 (searchable combos/filters patterns) 
  - catalog-view-bugfixes-v0-1 Run Card (test discipline) :contentReference[oaicite:4]{index=4}
- status: in-progress