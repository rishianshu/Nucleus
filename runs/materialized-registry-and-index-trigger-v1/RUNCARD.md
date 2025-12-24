# Run Card — materialized-registry-and-index-trigger-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: materialized-registry-and-index-trigger-v1

SCOPE: Implement only what's required to satisfy `intents/materialized-registry-and-index-trigger-v1/ACCEPTANCE.md`. No extra features.

INPUTS:

* intents/materialized-registry-and-index-trigger-v1/INTENT.md
* intents/materialized-registry-and-index-trigger-v1/SPEC.md
* intents/materialized-registry-and-index-trigger-v1/ACCEPTANCE.md
* docs/meta/*
* runs/materialized-registry-and-index-trigger-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:

* runs/materialized-registry-and-index-trigger-v1/PLAN.md (update each sub-goal)
* runs/materialized-registry-and-index-trigger-v1/LOG.md (heartbeat every 40–45 minutes)
* runs/materialized-registry-and-index-trigger-v1/QUESTIONS.md (blocking issues with minimal repro)
* runs/materialized-registry-and-index-trigger-v1/DECISIONS.md (tiny assumptions)
* runs/materialized-registry-and-index-trigger-v1/TODO.md (tiny follow-ups)
* Code + tests to turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:

* All acceptance checks pass, OR
* A blocking question is logged in QUESTIONS.md, and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/materialized-registry-and-index-trigger-v1/STORY.md.

GUARDRAILS:

* Do not modify *_custom.* or // @custom blocks.
* Prefer *_gen.* or // @generated blocks.
* Keep `make ci-check` < 8 minutes.
* Fail-closed on ambiguity.

TASKS FOR THIS RUN:

1. Implement/confirm `materialized_artifacts` registry schema + store with idempotent upsert keyed by (tenantId, sourceRunId, artifactKind). (AC1, AC3)
2. Wire ingestion completion to registry upsert (derive tenantId from auth/run context; never accept as API arg). (AC1, AC4)
3. Trigger indexing workflow with only `{ materializedArtifactId }` and ensure indexer reads via registry handle. (AC2)
4. Add failure/status transitions (`READY/INDEXING/INDEXED/FAILED`) and rerun behavior. (AC5)
5. Add tests: registry idempotency, tenant scoping, canonical meta mapping for at least two source families. (AC1–AC5)

ENV / NOTES:

* Tenant must be derived from auth token / run context (non-negotiable).
* Do not pass raw data through Temporal inputs; use registry handle only.
