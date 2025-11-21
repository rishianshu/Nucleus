- title: KB Admin Console — UX Polish v1 (graph view, facets, no flicker, copy feedback)
- slug: kb-admin-console-polish-v1
- type: feature
- context:
  - apps/metadata-console (KB: Overview, Nodes, Edges, Scenes, Provenance)
  - apps/metadata-api (graph read resolvers)
  - ADR-UI / ADR-Data-Loading patterns (keep parity with Catalog) 
- why_now: v1 is functional but has UX gaps: lists only (no graph), filters use free text where facets exist, type labels/values don't align (e.g., “Datasets” vs `catalog.dataset`), list re-queries flicker, and “Copy” lacks confirmation. Fixing these will materially improve trust and speed.
- scope_in:
  - Graph toggle on **Nodes** and **Edges** tabs: “List | Graph” (lightweight SVG/d3-force), animated transitions; keep caps aligned with Scenes.
  - Faceted filters: server-derived drop‑downs for **type/edgeType/project/domain/team**; free‑text search remains for regex/partial.
  - Label/value alignment: map human labels ⇄ canonical values (e.g., “Datasets” ↔ `catalog.dataset`) using a shared resolver.
  - No‑flicker search: debounced inputs, keep-previous-data while fetching, cursor pagination preserved.
  - Copy feedback: morph icon to ✓ and show small toast; restore after 1.5s; ARIA live message.
  - Scenes polish: visible truncation banner when caps hit; subtle layout animation on render/update.
- scope_out:
  - Graph mutations, HITL curation queue, deep KB editing (separate slugs).
- acceptance:
  1. **Facet drop‑downs** present for type/edgeType/project/domain/team with values from server; selecting emits canonical value; labels humanized.
  2. **Search has no flicker**: previous rows stay visible while new data loads; pagination & selection do not reset unexpectedly.
  3. **Copy** shows confirmation (icon morph + toast; announced via ARIA).
  4. **Graph view** renders current result set with animated layout; toggling back to List preserves filters and selection.
  5. **Scenes** show a truncation banner (e.g., “Capped at 150 nodes / 300 edges”) when limits are hit; layout gently animates in.
  6. ADR patterns respected (debounce 250–400 ms, cursor pagination, loading skeletons, error toasts, empty states). 
- constraints:
  - Additive GraphQL only; no breaking schema.
  - Keep bundle light (SVG + `d3-force` is acceptable; avoid heavy graph libs).
  - Reuse ADR hooks from Catalog for data loading & action feedback. 
- non_negotiables:
  - Server‑scoped reads remain enforced.
  - All queries remain paginated/bounded; no unbounded graph loads.
- refs:
  - catalog-view-and-ux-v1 SPEC (ADR patterns baseline) :contentReference[oaicite:2]{index=2}
  - catalog-view-bugfixes-v0-1 (loading/feedback & pagination patterns) 
- status: in-progress