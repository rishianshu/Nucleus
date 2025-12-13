# Run Card — ucl-ingestion-pipe-and-adaptive-planning-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ucl-ingestion-pipe-and-adaptive-planning-v1

SCOPE: Implement only what's required to satisfy `intents/ucl-ingestion-pipe-and-adaptive-planning-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/ucl-ingestion-pipe-and-adaptive-planning-v1/INTENT.md
- intents/ucl-ingestion-pipe-and-adaptive-planning-v1/SPEC.md
- intents/ucl-ingestion-pipe-and-adaptive-planning-v1/ACCEPTANCE.md
- docs/meta/*
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/PLAN.md
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/QUESTIONS.md
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/DECISIONS.md
- runs/ucl-ingestion-pipe-and-adaptive-planning-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/ucl-ingestion-pipe-and-adaptive-planning-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Keep CI runtime stable.
- Fail-closed on ambiguity.

TASKS FOR THIS RUN:
1) Implement StagingProvider interface and two providers:
   - Object store (MinIO) provider for large runs
   - Memory provider for small runs with strict byte caps
2) Refactor ingestion workflow so bulk records never flow through Temporal payloads:
   - Source writes to staging, returns stageRef
   - Sink reads from stageRef and persists
3) Add ProbeIngestion + PlanIngestion hooks for Jira and Confluence endpoints:
   - deterministic sliceIds
   - bounded slices (page limits)
4) Wire operation progress counters to reflect slices and staged/sunk totals.
5) Add tests for AC1–AC4 (large run safety, deterministic plans, e2e progress, negative cases).
6) Run repo CI commands required for UCL + metadata-api integration and keep them green.

ENV / NOTES:
- Use stub source/sink endpoints in tests; do not require real Jira/Confluence.
- Enforce fail-closed behavior when staging is required but unavailable.
