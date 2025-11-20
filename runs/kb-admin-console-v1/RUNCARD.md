# Run Card — kb-admin-console-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-admin-console-v1

SCOPE: Implement the KB Admin Console (nav + Explorer: Nodes/Edges, Scenes, Provenance) so all items in `intents/kb-admin-console-v1/ACCEPTANCE.md` pass. No destructive KB edits in this run.

INPUTS:
- intents/kb-admin-console-v1/INTENT.md
- intents/kb-admin-console-v1/SPEC.md
- intents/kb-admin-console-v1/ACCEPTANCE.md
- docs/meta/ADR-UI-Actions-and-States.md
- docs/meta/ADR-Data-Loading-and-Pagination.md

OUTPUTS:
- runs/kb-admin-console-v1/PLAN.md
- runs/kb-admin-console-v1/LOG.md (heartbeat 10–15 min)
- runs/kb-admin-console-v1/QUESTIONS.md
- runs/kb-admin-console-v1/DECISIONS.md
- runs/kb-admin-console-v1/TODO.md
- Code + tests with all ACs green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC/commit; reference AC#)

GUARDRAILS:
- Additive GraphQL only; RBAC scope filtering on all resolvers.
- Follow ADR-UI + ADR-Data-Loading (loading/error/empty; debounced search; cursor pagination).
- `make ci-check` < 8 minutes.

TASKS:
1) Nav: add KB section; link legacy “Graph identities” link to KB Explorer.
2) GraphQL: implement `kbNodes`, `kbEdges`, `kbNode`, `kbNeighbors`, `kbScene` (additive, scope-filtered).
3) Nodes Explorer: table + filters + side panel with identity/scope/provenance and “Open in …” actions.
4) Edges Explorer: table + filters; chips deep-link to Nodes Explorer.
5) Scenes: bounded neighborhood (depth 1–3), caps + truncation notice; list sync.
6) Provenance: last N writes for selected node.
7) Playwright: AC1–AC6 e2e tests; contract tests for new GraphQL fields.

ENV / NOTES:
- Reuse existing list/table components + `usePagedQuery`/`useAsyncAction` hooks.
- Avoid new heavy graph libs; basic canvas/SVG is sufficient for v1 with caps.
