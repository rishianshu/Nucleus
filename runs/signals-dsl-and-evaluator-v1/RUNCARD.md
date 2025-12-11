# Run Card — signals-dsl-and-evaluator-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: signals-dsl-and-evaluator-v1

SCOPE: Implement a minimal versioned Signal DSL and a batch evaluator that reads SignalDefinitions, queries CDM (work/docs), and upserts SignalInstances via SignalStore. Expose a GraphQL mutation and/or CLI entrypoint to trigger evaluation and return a summary. Do not implement scheduling, SignalBus, or KB projection in this slug.

INPUTS:
- intents/signals-dsl-and-evaluator-v1/INTENT.md
- intents/signals-dsl-and-evaluator-v1/SPEC.md
- intents/signals-dsl-and-evaluator-v1/ACCEPTANCE.md
- intents/signals-epp-foundation-v1/*
- docs/meta/nucleus-architecture/STORES.md
- CDM Work/Docs specs and existing explorers
- runs/signals-dsl-and-evaluator-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/signals-dsl-and-evaluator-v1/PLAN.md
- runs/signals-dsl-and-evaluator-v1/LOG.md
- runs/signals-dsl-and-evaluator-v1/QUESTIONS.md
- runs/signals-dsl-and-evaluator-v1/DECISIONS.md
- runs/signals-dsl-and-evaluator-v1/TODO.md
- Implementation of the Signal DSL parsing and type dispatch
- SignalEvaluator (or equivalent) module and its unit tests
- GraphQL mutation and/or CLI entrypoint to trigger evaluation, plus integration tests
- Test fixtures / seed data for CDM Work/Docs and signals
- Architecture doc describing DSL v1 and evaluator behaviour

LOOP:
Plan → Implement DSL & parsing → Implement evaluator & CDM queries → Wire GraphQL/CLI → Seed examples → Add tests → Update docs → Run CI.

HEARTBEAT:
Append an entry to `runs/signals-dsl-and-evaluator-v1/LOG.md` every **40–45 minutes** with:

- `timestamp` (UTC ISO),
- `done` (what was completed),
- `next` (what is planned next),
- `risks` (any emerging issues).

STOP WHEN:
- All acceptance criteria in `intents/signals-dsl-and-evaluator-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/signals-dsl-and-evaluator-v1/QUESTIONS.md` and `sync/STATE.md` is updated to blocked.

POST-RUN:
- Update `sync/STATE.md` with the latest status and timestamp for this slug.
- Append a short narrative entry to `stories/signals-dsl-and-evaluator-v1/STORY.md`.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` regions.
- Prefer additive changes (new modules, new GraphQL types/mutations) over breaking changes.
- Keep `pnpm ci-check` under the existing time budget and fully green.
- No changes to ingestion/UCL code paths beyond read-only CDM queries.

TASKS:
1) Define the v1 Signal DSL envelope (`version`, `type`, `config`) and update the existing example SignalDefinitions to use it (work-stale, doc-orphan).
2) Implement a SignalEvaluator that:
   - Loads ACTIVE definitions (optionally filtered by slug),
   - Parses `definitionSpec`,
   - Dispatches to per-type evaluators for `cdm.work.stale_item` and `cdm.doc.orphan`,
   - Upserts SignalInstances via SignalStore idempotently.
3) Wire a GraphQL mutation (`evaluateSignals`) and/or CLI to invoke the evaluator and return a summary, and add integration tests using seeded CDM and signal data.
4) Add architecture/docs page explaining the DSL, evaluator flow, and how to author new signals using v1, then run `pnpm ci-check` to verify everything passes.
