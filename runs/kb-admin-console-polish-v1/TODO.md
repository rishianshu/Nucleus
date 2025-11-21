## TODO — kb-admin-console-polish-v1

- [x] Audit current KB console (Nodes/Edges/Scenes) to capture exact delta vs ACs; document facets + copy UX requirements.
- [x] Implement `kbFacets` GraphQL query/resolver + caching helpers; add unit coverage and README note.
- [x] Introduce shared label/value mapping util for canonical ↔ human text; apply to tables and filters.
- [x] Replace manual text filters with facet combos (multi-select where needed) for type/edgeType/project/domain/team.
- [x] Implement “keep previous data” loading states + skeleton rows and preserve selection/scroll during refetch.
- [x] Add copy feedback (icon morph, toast, ARIA live region) for logical key actions.
- [x] Add List|Graph toggle in Nodes/Edges with SVG force layout bound by limits; ensure toggling preserves filters/selection.
- [x] Display truncation banner + gentle layout animation in Scenes view when caps hit.
- [x] Extend Playwright coverage for facets, copy feedback, and graph toggle; rerun unit + e2e suites with console log capture.
