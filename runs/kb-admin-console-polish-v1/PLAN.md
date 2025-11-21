# PLAN — kb-admin-console-polish-v1

## Strategy

1. **Scope + audit** – inventory current KB console (nodes/edges/scenes) vs INTENT gaps. Capture actionable TODO items by panel to avoid missing ACs.
2. **Backend support** – additive `kbFacets` query + shared label/value helpers so UI facets and chips stay canonical. Cover with schema unit tests.
3. **Explorer polish** – facet-driven combos, keep-previous-data loading, copy confirmations, and ADR-compliant skeletons for both Nodes and Edges.
4. **Graph experience** – implement List↔Graph toggle (SVG + d3-force) that respects filters and selection preservation; apply Scenes truncation banner + layout animation.
5. **Verification + docs** – update Playwright flows, run unit/vitest suites, capture headless console logs, and refresh STORY/STATE artifacts.

## Milestones

- **M1:** kbFacets resolver + label mapping helper landed with tests.
- **M2:** Nodes/Edges explorers expose facet combos, no flicker, and improved copy feedback.
- **M3:** Graph toggle + scenes banner shipped with Playwright coverage; slug ready for review.
