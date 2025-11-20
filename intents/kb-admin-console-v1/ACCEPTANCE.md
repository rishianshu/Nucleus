## `intents/kb-admin-console-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) KB menu + migration of identities
   - Type: e2e
   - Evidence: Top-level "Knowledge Base" appears with Overview/Explorer/Scenes; legacy “Graph identities” list in Endpoints links to KB Explorer.

2) Nodes Explorer basics
   - Type: e2e
   - Evidence: Nodes list paginates (cursor), filters by type and scope, debounced search works; selecting a row opens side panel with identity.logicalKey, scope chips, provenance fields.

3) Edges Explorer basics
   - Type: e2e
   - Evidence: Edges list paginates and filters by edgeType/scope; source/target chips deep-link to Nodes Explorer with the corresponding node preselected.

4) Scenes viewer
   - Type: e2e
   - Evidence: Given a node id, depth=2 and an allowlist of edge types render a subgraph; UI shows node/edge counts and truncates with a notice when caps are exceeded.

5) Provenance view
   - Type: integration + e2e
   - Evidence: For a selected node, last N writes show ts, phase, originEndpoint, revision; table sorts by ts desc.

6) ADR-UI/Data-Loading conformance
   - Type: e2e
   - Evidence: All lists show loading skeletons, error banners with retry, and empty states; search/filters reset pagination and refetch; copy identity shows a toast. :contentReference[oaicite:11]{index=11} :contentReference[oaicite:12]{index=12}
````

---

