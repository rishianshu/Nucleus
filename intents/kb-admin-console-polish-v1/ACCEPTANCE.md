# Acceptance Criteria

1) Faceted filters
   - Type: e2e
   - Evidence: Type drop‑down shows “Datasets” but applies value `catalog.dataset`; edgeType/project/domain/team combos populate from `kbFacets`; multi-select works.

2) No‑flicker search
   - Type: e2e
   - Evidence: Typing in search (debounced 250–400 ms) keeps previous rows visible until new data is ready; selection & scroll remain; cursor pagination intact.

3) Copy confirmation
   - Type: e2e + a11y
   - Evidence: Clicking “Copy” flips icon to ✓, shows a toast “Logical key copied”, announces via ARIA live region, and reverts in ≤ 1.5s.

4) Graph view
   - Type: e2e
   - Evidence: Switching to Graph shows the same filtered set (≤ 300 nodes / ≤ 600 edges), with a brief layout animation; switching back to List preserves selection.

5) Scenes truncation + animation
   - Type: e2e
   - Evidence: With inputs that exceed caps, UI shows “Scene truncated…” banner; initial layout animates, then stabilizes.

6) ADR conformance
   - Type: e2e
   - Evidence: Loading skeletons, error toasts, and empty states render per ADR; search/filters reset pagination and refetch predictably. 
