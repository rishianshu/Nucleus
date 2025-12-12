# Run Card — kg-cdm-and-signals-bridge-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kg-cdm-and-signals-bridge-v1

SCOPE: Implement only what's required to satisfy `intents/kg-cdm-and-signals-bridge-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/kg-cdm-and-signals-bridge-v1/INTENT.md
- intents/kg-cdm-and-signals-bridge-v1/SPEC.md
- intents/kg-cdm-and-signals-bridge-v1/ACCEPTANCE.md
- docs/meta/*
- runs/kg-cdm-and-signals-bridge-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/kg-cdm-and-signals-bridge-v1/PLAN.md (update each sub-goal)
- runs/kg-cdm-and-signals-bridge-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/kg-cdm-and-signals-bridge-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/kg-cdm-and-signals-bridge-v1/DECISIONS.md (tiny assumptions)
- runs/kg-cdm-and-signals-bridge-v1/TODO.md (tiny follow-ups)
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
- Append a line to stories/kg-cdm-and-signals-bridge-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* files or // @custom blocks.
- Prefer *_gen.* files or // @generated blocks when adding new generated code.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity; if any KG or bridge contract feels underspecified,
  pause and log a QUESTION with a concrete example.

TASKS FOR THIS RUN:
1) Implement CdmToKgBridge to project cdm.work.item and cdm.doc.item rows into KG nodes
   (and minimal associated edges) via GraphWrite.
2) Implement SignalsToKgBridge to project SignalInstance rows into signal.instance
   nodes and HAS_SIGNAL edges via GraphWrite.
3) Ensure bridges are idempotent by using stable nodeId conventions and relying on
   GraphWrite's idempotent upsert semantics.
4) Add tests for:
   - CDM→KG projection (AC1),
   - Signals→KG projection (AC2),
   - idempotency (AC3),
   - KG/KB read visibility (AC4).
5) Run `pnpm ci-check` and ensure all suites remain green.

ENV / NOTES:
- Use existing CDM stores and SignalStore abstractions; do not create parallel
  persistence for CDM or Signals.
- For tests, seed CDM and Signal data using existing factories/fixtures where possible.
- Event/stream wiring (e.g. Temporal or Kafka) is out of scope; this is a batch bridge.
