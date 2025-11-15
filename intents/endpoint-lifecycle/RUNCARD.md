# Run Card — endpoint-lifecycle

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: endpoint-lifecycle

SCOPE: Implement only what’s required to satisfy `intents/endpoint-lifecycle/ACCEPTANCE.md` (CRUD, collections, bad/good creds cycle, soft delete, UI state contract). No extra features.

INPUTS:

* intents/endpoint-lifecycle/INTENT.md
* intents/endpoint-lifecycle/SPEC.md
* intents/endpoint-lifecycle/ACCEPTANCE.md
* docs/meta/ADR-0001-ui-state-contract.md
* runs/endpoint-lifecycle/*

OUTPUTS:

* runs/endpoint-lifecycle/PLAN.md
* runs/endpoint-lifecycle/LOG.md
* runs/endpoint-lifecycle/QUESTIONS.md
* runs/endpoint-lifecycle/DECISIONS.md
* runs/endpoint-lifecycle/TODO.md
* Code + tests that turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤150 LOC/commit, reference AC#)

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}

STOP WHEN:

* All acceptance checks pass OR
* Blocking question logged and STATE=blocked

POST-RUN:
Update sync/STATE.md (Last Run) and append to stories/endpoint-lifecycle/STORY.md

GUARDRAILS:

* Do not modify *_custom.* or // @custom blocks
* Prefer *_gen.* or // @generated blocks
* Keep `make ci-check` < 8 minutes
* No secrets in logs/errors
* Fail-closed on ambiguity

TASKS FOR THIS RUN:

1. **DB model**: Add `deletedAt` & `lastTestOkAt` to MetadataEndpoint (migration).
2. **GraphQL**:

   * Filter deleted endpoints from list
   * Implement auto-trigger on register
   * Enforce credential-change test gating
   * Implement soft delete + all error codes
3. **Temporal integration**: auto-trigger & manual-trigger paths
4. **Dataset filtering**: hide datasets for soft-deleted endpoints
5. **UI** (Endpoints list, detail, datasets): comply with ADR-0001
6. **Tests**: integration + Playwright for AC1–AC6
7. **Perf sanity**: `endpoints(first:50)` p95 check

ENV / NOTES:
Use local Postgres (`jira_plus_plus`, user/password `postgres`). Ensure SPA token includes `viewer` (or mapped role).
