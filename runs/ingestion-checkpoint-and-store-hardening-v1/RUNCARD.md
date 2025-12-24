# Run Card — ingestion-checkpoint-and-store-hardening-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-checkpoint-and-store-hardening-v1

SCOPE: Harden ingestion checkpointing and migrate store.

INPUTS:
- intents/ingestion-checkpoint-and-store-hardening-v1/INTENT.md
- intents/ingestion-checkpoint-and-store-hardening-v1/SPEC.md
- intents/ingestion-checkpoint-and-store-hardening-v1/ACCEPTANCE.md
- docs/meta/*
- runs/ingestion-checkpoint-and-store-hardening-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/ingestion-checkpoint-and-store-hardening-v1/PLAN.md
- runs/ingestion-checkpoint-and-store-hardening-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/ingestion-checkpoint-and-store-hardening-v1/QUESTIONS.md
- runs/ingestion-checkpoint-and-store-hardening-v1/DECISIONS.md
- runs/ingestion-checkpoint-and-store-hardening-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Fail-closed on ambiguity.

TASKS FOR THIS RUN:
1) Enforce strict SinkID validation in startIngestionRun/RunIngestionUnit.
2) Fix checkpoint merging to flatten recursive cursors.
3) Migrate ingestion checkpoint storage from file-based to ucl-core/pkg/kvstore (via kv_client).
4) Verify fix with repro tests (TestMergeCheckpoints_FlattensNesting).
