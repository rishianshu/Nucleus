# Run Card — signals-extensibility-and-packs-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: signals-extensibility-and-packs-v1

SCOPE: Make the signals system extensible so most new signals can be added via DSL and seed curated signal packs for Jira and Confluence, while preserving support for a small number of code-backed types. Do not introduce real-time SignalBus or new UI surfaces in this slug.

INPUTS:
- intents/signals-extensibility-and-packs-v1/INTENT.md
- intents/signals-extensibility-and-packs-v1/SPEC.md
- intents/signals-extensibility-and-packs-v1/ACCEPTANCE.md
- intents/signals-epp-foundation-v1/*
- intents/signals-dsl-and-evaluator-v1/*
- intents/signals-evaluator-scaling-v1/*
- CDM work/docs models and stores
- SignalStore implementation
- Existing SignalDefinition seeds (if any)
- docs/meta/nucleus-architecture/STORES.md
- runs/signals-extensibility-and-packs-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/signals-extensibility-and-packs-v1/PLAN.md
- runs/signals-extensibility-and-packs-v1/LOG.md
- runs/signals-extensibility-and-packs-v1/QUESTIONS.md
- runs/signals-extensibility-and-packs-v1/DECISIONS.md
- runs/signals-extensibility-and-packs-v1/TODO.md
- DB migrations for SignalDefinition implMode and metadata
- Evaluator registry and `cdm.generic.filter` implementation
- Seeded SignalDefinitions for Jira and Confluence packs
- Tests for registry dispatch and DSL-based signals
- Documentation on signal extensibility and packs

LOOP:
Plan → Add SignalDefinition fields + migrations → Wire evaluator registry → Implement `cdm.generic.filter` → Seed packs and tests → Update docs → Run CI.

HEARTBEAT:
Append an entry to `runs/signals-extensibility-and-packs-v1/LOG.md` every **40–45 minutes** with:
- `timestamp` (UTC ISO)
- `done` (what was completed)
- `next` (planned next steps)
- `risks` (any new concerns)

STOP WHEN:
- All acceptance criteria in `intents/signals-extensibility-and-packs-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/signals-extensibility-and-packs-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` with the latest status and timestamp for this slug.
- Append a short narrative entry to `stories/signals-extensibility-and-packs-v1/STORY.md` summarizing changes and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` regions.
- Keep all changes backward compatible; do not break existing SignalDefinitions.
- Keep `pnpm ci-check` fully green; no skipping of tests.
- Keep DSL safe and bounded; no arbitrary execution or raw SQL injection.

TASKS:
1) Extend SignalDefinition schema and TS types with `implMode`, `sourceFamily`, EPP metadata, and `surfaceHints`, plus migrations.
2) Introduce an evaluator registry keyed by `spec.type` and refactor the evaluator to use it, including robust handling of unknown types.
3) Implement the `cdm.generic.filter` DSL type and integrate it with the paged evaluation pattern from signals-evaluator-scaling-v1.
4) Seed Jira and Confluence signal packs using DSL-only definitions, add tests, update documentation, and run `pnpm ci-check`.
