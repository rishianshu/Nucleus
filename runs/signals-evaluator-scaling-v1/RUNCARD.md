# Run Card — signals-evaluator-scaling-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: signals-evaluator-scaling-v1

SCOPE: Refactor the signals evaluator to operate page-by-page over CDM data, remove the fixed 200-instance reconciliation cap, and harden error handling and unknown-type behavior. Do not change public evaluator/GraphQL signatures or move evaluation into Temporal in this slug.

INPUTS:
- intents/signals-evaluator-scaling-v1/INTENT.md
- intents/signals-evaluator-scaling-v1/SPEC.md
- intents/signals-evaluator-scaling-v1/ACCEPTANCE.md
- intents/signals-epp-foundation-v1/*
- apps/metadata-api/src/signals/evaluator.ts
- apps/metadata-api/src/signals/types.ts
- apps/metadata-api/src/signals/store/*
- apps/metadata-api/src/cdm/workStore.ts
- apps/metadata-api/src/cdm/docStore.ts
- docs/meta/nucleus-architecture/STORES.md
- runs/signals-evaluator-scaling-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/signals-evaluator-scaling-v1/PLAN.md (planning + sub-goals)
- runs/signals-evaluator-scaling-v1/LOG.md (heartbeat updates)
- runs/signals-evaluator-scaling-v1/QUESTIONS.md (blocking issues, if any)
- runs/signals-evaluator-scaling-v1/DECISIONS.md (small assumptions)
- runs/signals-evaluator-scaling-v1/TODO.md (follow-ups)
- Updated evaluator implementation (paged CDM access, full instance reconciliation, better error handling)
- Updated SignalStore implementation/tests if paging/run-token strategy is used
- New/updated unit + integration tests
- Updated docs describing evaluator scaling behavior

LOOP:
Plan → Refactor evaluator for CDM paging → Implement full instance reconciliation strategy → Harden error & unknown-type handling → Add tests → Update docs → Run CI.

HEARTBEAT:
Append an entry to `runs/signals-evaluator-scaling-v1/LOG.md` every **40–45 minutes** with:
- `timestamp` (UTC ISO string)
- `done` (short summary of completed work)
- `next` (planned next steps)
- `risks` (any emerging concerns)

STOP WHEN:
- All acceptance criteria in `intents/signals-evaluator-scaling-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/signals-evaluator-scaling-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` with the latest status and timestamp for `signals-evaluator-scaling-v1`.
- Append a short narrative to `stories/signals-evaluator-scaling-v1/STORY.md` explaining what changed and any important decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` regions.
- Prefer additive changes and internal refactors over breaking public APIs.
- Keep `pnpm ci-check` within existing time budgets and fully passing.
- Avoid introducing Temporal workflow dependencies in this slug.

TASKS:
1) Refactor CDM access in the evaluator to operate page-by-page (no full-table materialization).
2) Implement full instance reconciliation for each definition (remove 200-instance cap) using instance paging and/or a run-token strategy in SignalStore.
3) Harden definition-level error and unknown-type handling so broken definitions are reported in `skippedDefinitions` without aborting others.
4) Add/extend tests and update documentation to reflect the new evaluator behavior, then run `pnpm ci-check` to ensure everything is green.
