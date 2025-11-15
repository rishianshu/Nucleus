# Run Card — endpoint-lifecycle

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: endpoint-lifecycle

SCOPE: Implement and verify the Endpoint Lifecycle feature per intents/endpoint-lifecycle/SPEC.md so that all assertions in intents/endpoint-lifecycle/ACCEPTANCE.md pass. No unrelated refactors.

INVARIANTS (stable forever)
- Follow docs/meta/AGENT_CODEX.md exactly.
- Keep commits small (≤ ~150 LOC) and reference AC# or TODO label.
- Never change public contracts unless ACCEPTANCE.md requires it.
- Do not modify *_custom.* or // @custom blocks; prefer *_gen.* or // @generated.
- Preserve working Temporal workflows (`testConnection`, `triggerCollection`) and Keycloak role matrix (viewer/editor/admin).  # inherited requirement

DYNAMIC INPUTS (re-read every (re)start)
- ACCEPTANCE.md may change: always re-parse and verify the latest criteria (API + UI).
- TODO.md may change: execute only “small” items (≤ ~15 min, no contract change).
- If any TODO implies contract/schema/large UI scope, FAIL-CLOSED: log it in QUESTIONS.md proposing a new intent and STOP.
  
INPUTS:

* intents/endpoint-lifecycle/INTENT.md
* intents/endpoint-lifecycle/SPEC.md
* intents/endpoint-lifecycle/ACCEPTANCE.md
* docs/meta/*
* runs/endpoint-lifecycle/ *

OUTPUTS:

* runs/endpoint-lifecycle/PLAN.md
* runs/endpoint-lifecycle/LOG.md (heartbeat every 10–15 min)
* runs/endpoint-lifecycle/QUESTIONS.md (blocking issues)
* runs/endpoint-lifecycle/DECISIONS.md (tiny assumptions)
* runs/endpoint-lifecycle/TODO.md (tiny follow-ups)
* Code + tests (GraphQL schema, resolvers, UI wiring)

RESUME PROTOCOL (idempotent)
0) Read PLAN.md, last 40 lines of LOG.md, and TODO.md.
   - Detect completed steps from tests/LOG; skip repeated work.
   - Update PLAN.md with the next 3–5 sub-goals aligned to latest ACCEPTANCE.md + “small” TODOs.
   - Append heartbeat to LOG.md: {timestamp, done, next, risks}.
  
LOOP:
Plan → Implement → Test → Patch → Heartbeat.
Commits ≤ ~150 LOC; reference AC# or TODO label in each message.

HEARTBEAT:
Append to LOG.md every 10–15 min → `{timestamp, done, next, risks}`.

STOP WHEN:

* All acceptance checks pass, OR
* A blocking question with minimal repro is in QUESTIONS.md and STATE set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/endpoint-lifecycle/STORY.md.

GUARDRAILS:

* Do not modify *_custom.* or `// @custom` blocks.
* Prefer *_gen.* or `// @generated` blocks.
* Keep `make ci-check` < 8 minutes.
* Fail-closed on ambiguity.
* Preserve existing working Temporal workflows (`testConnection`, `triggerCollection`).
* Follow Keycloak role matrix (viewer/editor/admin) at API and UI.
* No changes to public contracts unless required by ACCEPTANCE.md.
* Secrets must be masked (API + UI); no clear-text credentials anywhere.
* Contract-diff CI (GraphQL/OpenAPI) must fail on breaking changes.

TASKS FOR THIS RUN:

TASKS FOR THIS RUN (idempotent; re-check on restart)
1) VERIFY CONTRACT / CLIENT
   - Regenerate API/GraphQL client if required; run typecheck. If clean, no-op.

2) IMPLEMENT/VERIFY FLOWS PER ACCEPTANCE.md (API + UI)
   - For each AC#: if tests are green, no-op; else implement minimal changes and re-test.
   - Ensure resolvers use structured errors with `extensions.code`.
   - Ensure masking helpers in API mappers and UI renders.

3) ROLE & CAPABILITY GUARDS
   - Enforce viewer/editor/admin & capability gates in resolvers and reflect them in UI visibility/disabled states.

4) TEMPORAL HOOKS
   - Wire `testEndpoint` / `triggerCollection` to existing workflows (no re-implementation if already working).

5) DATASET ASSOCIATION
   - Ensure workers tag `MetadataRecord.labels += ['endpoint:<endpointId>']`.
   - Implement/verify `endpointDatasets(endpointId, domain?)` + “Datasets” tab render.

6) EXECUTE SMALL TODOs
   - Apply only items marked small (≤ ~15 min, no contract change).
   - Any larger item → open QUESTIONS.md with a 1–2 sentence new-intent proposal and STOP.

7) PERF & CI GUARDS
   - Perf smoke: `endpoints(first:50)` p95 ≤ 300 ms with ~100 endpoints (local).
   - Contract diff job (GraphQL/OpenAPI) enabled and passing.
   - Keep `make ci-check` under budget.

ENV / NOTES:

* Use local metadata Postgres (.env.example); no real secrets.
* Respect existing Prisma model names (`MetadataEndpoint`, etc.).
* If Temporal or Keycloak config ambiguous, pause and record QUESTIONS.md with repro snippet.

DONE WHEN:

* All ACCEPTANCE.md checks green.
* CI passes (< 8 min).
* sync/STATE.md updated with successful run timestamp.
