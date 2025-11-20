## TODO — kb-admin-console-v1

- [x] Audit existing metadata console routing/nav + GraphStore utilities to define insertion points for Knowledge Base section.
- [x] Extend GraphQL schema/resolvers with kbNodes/kbEdges/kbNode/kbNeighbors/kbScene queries (cursor pagination, scope filtering, provenance data) plus tests.
- [x] Add KB top-level nav + subroutes (overview, nodes, edges, scenes, provenance); convert legacy "Graph identities" list into a link.
- [x] Implement Nodes Explorer view (filters, debounced search, paginated table, side panel with identity/scope/provenance + actions).
- [x] Implement Edges Explorer view with edge type + source/target filters and deep-link chips into Nodes Explorer.
- [x] Build Scenes view (node selector, depth/edge-type controls, bounded visualization/list sync with truncation messaging).
- [x] Implement Provenance tab/view surfacing recent writes (phase, origin endpoint, timestamps) for selected nodes.
- [x] Add copy-to-clipboard + toast feedback for logical keys/identities per ADR.
- [x] Update Playwright + unit/contract tests covering AC1–AC6.
- [x] Run full test suite, update docs/story/state, and prep for commit.
