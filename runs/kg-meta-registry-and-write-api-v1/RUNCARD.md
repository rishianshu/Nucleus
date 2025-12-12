# Run Card — kg-meta-registry-and-write-api-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kg-meta-registry-and-write-api-v1

SCOPE: Implement only what's required to satisfy `intents/kg-meta-registry-and-write-api-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/kg-meta-registry-and-write-api-v1/INTENT.md
- intents/kg-meta-registry-and-write-api-v1/SPEC.md
- intents/kg-meta-registry-and-write-api-v1/ACCEPTANCE.md
- docs/meta/*
- runs/kg-meta-registry-and-write-api-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/kg-meta-registry-and-write-api-v1/PLAN.md (update each sub-goal)
- runs/kg-meta-registry-and-write-api-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/kg-meta-registry-and-write-api-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/kg-meta-registry-and-write-api-v1/DECISIONS.md (tiny assumptions)
- runs/kg-meta-registry-and-write-api-v1/TODO.md (tiny follow-ups)
- Code + tests to turn all acceptance checks green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC# in each message).

HEARTBEAT:
Append to LOG.md every 40–45 minutes: `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md, and STATE=blocked.

POST-RUN:
- Update sync/STATE.md Last Run and Focus Feature to this slug with status and test evidence.
- Append a line to stories/kg-meta-registry-and-write-api-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* files or // @custom blocks.
- Prefer *_gen.* files or // @generated blocks when adding new generated code.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity; if any KG contract feels underspecified, pause and log a QUESTION with a concrete example.

TASKS FOR THIS RUN:
1) Add node-type and edge-type registry tables and seed initial types (cdm.work.item, cdm.doc.item,
   column.profile, column.description, signal.instance, kg.cluster and core edge types).
2) Implement GraphWrite.upsertNode with registry validation and idempotent persistence via GraphStore.
3) Implement GraphWrite.upsertEdge with registry validation (from/to types) and idempotent persistence via GraphStore.
4) Add tests for:
   - nodeType and edgeType enforcement (AC1, AC2),
   - idempotency (AC3),
   - enrichment node types (column.profile/column.description) being created and queryable (AC4).
5) Run `pnpm ci-check` and ensure all suites remain green.

ENV / NOTES:
- Use the existing metadata-api dev stack and GraphStore implementation as the source of truth.
- Registry seeding should be done via migrations so that CI and dev environments share the same types.
- This slug does not wire CDM/Signals event listeners; only the registry and write API are in scope.
