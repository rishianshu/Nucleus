# Run Card — signals-surfaces-and-filters-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: signals-surfaces-and-filters-v1

SCOPE: Add a first-class Signals exploration API and UI so users (and future agents) can list, filter, and navigate SignalInstances, and lights surface signals on CDM work/doc detail pages. Do not introduce lineage/KG changes or real-time inbox behavior in this slug.

INPUTS:
- intents/signals-surfaces-and-filters-v1/INTENT.md
- intents/signals-surfaces-and-filters-v1/SPEC.md
- intents/signals-surfaces-and-filters-v1/ACCEPTANCE.md
- intents/signals-epp-foundation-v1/*
- intents/signals-evaluator-scaling-v1/*
- intents/signals-extensibility-and-packs-v1/*
- apps/metadata-api/src/signals/*
- apps/metadata-api/src/cdm/*
- apps/metadata-api GraphQL schema and resolvers
- apps/metadata-ui (shell, CDM explorers, KB console)
- runs/signals-surfaces-and-filters-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/signals-surfaces-and-filters-v1/PLAN.md
- runs/signals-surfaces-and-filters-v1/LOG.md
- runs/signals-surfaces-and-filters-v1/QUESTIONS.md
- runs/signals-surfaces-and-filters-v1/DECISIONS.md
- runs/signals-surfaces-and-filters-v1/TODO.md
- GraphQL schema/resolvers for `signalInstances` (+ `signalsForEntity` if added)
- UI components/routes for the Signals view with filters and navigation
- CDM work/doc detail integration showing associated signals
- Unit/integration/Playwright tests covering new behavior

LOOP:
Plan → Implement GraphQL signals exploration → Implement Signals UI view → Wire signals into CDM detail pages → Add tests → Run CI.

HEARTBEAT:
Append an entry to `runs/signals-surfaces-and-filters-v1/LOG.md` every **40–45 minutes** with:
- `timestamp` (UTC ISO)
- `done` (what was completed)
- `next` (planned next steps)
- `risks` (any concerns or blockers)

STOP WHEN:
- All acceptance criteria in `intents/signals-surfaces-and-filters-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/signals-surfaces-and-filters-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` with the latest status and timestamp for this slug.
- Append a short narrative entry to `stories/signals-surfaces-and-filters-v1/STORY.md` describing the completed work and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` regions.
- Keep GraphQL changes additive and backward compatible.
- Reuse existing loading/error UX patterns in metadata-ui.
- Keep `pnpm ci-check` fully green; do not skip or comment out tests.

TASKS:
1) Add and implement GraphQL queries/types for signal exploration (`signalInstances`, optionally `signalsForEntity`), supporting required filters and pagination.
2) Build a Signals view in metadata-ui with filter controls, a signals table, and actions to navigate to CDM entity and upstream source.
3) Integrate signals into CDM work/doc detail pages (show active signals and link to the Signals view for that entity).
4) Add unit/integration/Playwright tests and run `pnpm ci-check` to validate the new behavior.
