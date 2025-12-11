# Run Card — signals-epp-foundation-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: signals-epp-foundation-v1

SCOPE: Introduce first-class Signals for Nucleus by defining SignalDefinition/SignalInstance models, a SignalStore interface and implementation, read-only GraphQL queries, seed examples, and documentation of their relationship to CDM and KB. Do not implement a full DSL, evaluator, or KB projection yet.

INPUTS:
- intents/signals-epp-foundation-v1/INTENT.md
- intents/signals-epp-foundation-v1/SPEC.md
- intents/signals-epp-foundation-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/STORES.md
- docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- Existing CDM Work/Docs schemas and explorers
- Existing GraphStore/KB architecture docs
- runs/signals-epp-foundation-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/signals-epp-foundation-v1/PLAN.md (updated as work progresses)
- runs/signals-epp-foundation-v1/LOG.md
- runs/signals-epp-foundation-v1/QUESTIONS.md (if any blocking ambiguity arises)
- runs/signals-epp-foundation-v1/DECISIONS.md (record small assumptions)
- runs/signals-epp-foundation-v1/TODO.md (small follow-ups)
- Prisma models and migrations for SignalDefinition/SignalInstance
- SignalStore interface + Prisma-backed implementation + unit tests
- GraphQL schema and resolvers for read-only signal queries + integration tests
- Seeded example signal definitions (work + docs) and synthetic instances for tests
- Architecture doc describing Signals/EPP and their relation to CDM and KB

LOOP:
Plan → Implement models and store → Wire GraphQL + seeds → Add tests → Update docs → Run CI → Finalize.

HEARTBEAT:
Append a heartbeat entry to `runs/signals-epp-foundation-v1/LOG.md` every **40–45 minutes** with:

- `timestamp` (UTC ISO string),
- `done` (short summary of what was completed),
- `next` (what will be tackled next),
- `risks` (any emerging concerns or blockers).

STOP WHEN:
- All acceptance criteria in `intents/signals-epp-foundation-v1/ACCEPTANCE.md` are satisfied, **or**
- A blocking ambiguity is logged in `runs/signals-epp-foundation-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` with the last run status and timestamp for `signals-epp-foundation-v1`.
- Append a brief entry to `stories/signals-epp-foundation-v1/STORY.md` describing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Prefer additive changes (new tables, new types, new queries) over breaking modifications.
- Keep `pnpm ci-check` green; do not disable or skip existing tests.
- Maintain backward compatibility for public GraphQL APIs (only new types/queries are allowed).

TASKS:
1) Add Prisma models and migrations for `signal_definitions` and `signal_instances`, including EPP-related fields and CDM/KB reference fields.
2) Implement a `SignalStore` interface and Prisma-backed implementation, plus unit tests covering definitions and instances (CRUD, filters, upserts).
3) Extend the GraphQL schema and resolvers with read-only queries (`signalDefinitions`, `signalDefinition`, `signalInstances`, `signalInstance`) and add integration tests.
4) Seed at least two example signal definitions (one work-centric, one doc-centric) and synthetic instances in tests to validate the read path.
5) Write or update architecture docs to describe the Signals/EPP model, how it relates to CDM and KB, and how future evaluators will use it, then run `pnpm ci-check` to confirm all tests pass.
