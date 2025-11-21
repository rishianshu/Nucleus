# KB Admin Console — UX Polish v1

- Added additive kbFacets query + caching so facet combos stay canonical and fast; shared label helpers ensure table/chip consistency.
- Nodes/Edges explorers now use facet combos, ADR copy feedback, and keep-previous-data loading with skeleton rows; List↔Graph toggle integrates a lightweight d3 force layout.
- Scenes view surfaces truncation banners when caps hit and animates layout updates; Playwright and Vitest suites pass headlessly with console logs captured.
