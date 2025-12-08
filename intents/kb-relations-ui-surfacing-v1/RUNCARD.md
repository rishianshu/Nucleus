# Run Card — kb-relations-ui-surfacing-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-relations-ui-surfacing-v1

SCOPE: Expose the relation kinds emitted by `kb-relations-and-lineage-v1` (structural + semantic) in the KB explorer and related UIs, via additive GraphQL changes and UI updates, while keeping CI green.

INPUTS:
- intents/kb-relations-ui-surfacing-v1/INTENT.md
- intents/kb-relations-ui-surfacing-v1/SPEC.md
- intents/kb-relations-ui-surfacing-v1/ACCEPTANCE.md
- intents/kb-relations-and-lineage-v1/*
- apps/metadata-api/src/schema.ts
- apps/metadata-api/src/graph/*
- apps/metadata-ui/src/features/knowledge-base/*
- apps/metadata-ui/src/features/catalog/*
- apps/metadata-ui/src/features/cdm/*
- tests/metadata-auth.spec.ts (KB + catalog sections)
- runs/kb-relations-ui-surfacing-v1/*

OUTPUTS:
- runs/kb-relations-ui-surfacing-v1/PLAN.md
- runs/kb-relations-ui-surfacing-v1/LOG.md
- runs/kb-relations-ui-surfacing-v1/QUESTIONS.md
- runs/kb-relations-ui-surfacing-v1/DECISIONS.md
- runs/kb-relations-ui-surfacing-v1/TODO.md
- GraphQL schema/resolver changes to support relation-kind filtered edge queries
- Updated KB explorer UI with relation kind filters and neighbor grouping
- Updated Catalog (and optionally Docs/Work) detail views to consume KB relations
- New tests (unit, integration, Playwright) and passing `pnpm ci-check`

LOOP:
Plan → Implement GraphQL relation filters/limits → Wire KB explorer UI (filters + detail grouping) → Update Catalog table detail → Add tests → Run `pnpm ci-check` → Iterate until all acceptance criteria pass.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/kb-relations-ui-surfacing-v1/ACCEPTANCE.md are satisfied, OR
- A blocking issue is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md with the result and last run time for `kb-relations-ui-surfacing-v1`.
- Append an entry to stories/kb-relations-ui-surfacing-v1/STORY.md summarizing what shipped.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep GraphQL changes additive; do not remove or rename existing fields.
- Keep KB queries bounded and performant; avoid unfiltered “select all relations”.
- Keep UI changes behind feature flags if needed to de-risk rollout.

TASKS:
1) Add/extend GraphQL fields to fetch KB edges by relation kind and direction with limits.
2) Update KB explorer UI to:
   - Show relation-kind filters,
   - Use relation-aware GraphQL,
   - Group neighbors by relation family in the detail panel.
3) Update Catalog table detail (and optionally Docs/Work detail) to read PK/FK and relevant relations from KB.
4) Add tests (unit/integration/e2e) covering relation filters, neighbor grouping, and Catalog table detail.
5) Run `pnpm ci-check` and fix regressions until everything passes.
