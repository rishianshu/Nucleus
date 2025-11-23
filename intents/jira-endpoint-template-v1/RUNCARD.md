## `runs/jira-endpoint-template-v1/RUNCARD.md`

```markdown
# Run Card — jira-endpoint-template-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: jira-endpoint-template-v1

SCOPE: Add the `http.jira` endpoint template, test-connection workflow, and driver registration for `listUnits` so that `intents/jira-endpoint-template-v1/ACCEPTANCE.md` passes. Do not implement `syncUnit` in this slug.

INPUTS:
- intents/jira-endpoint-template-v1/INTENT.md
- intents/jira-endpoint-template-v1/SPEC.md
- intents/jira-endpoint-template-v1/ACCEPTANCE.md
- ingestion-core-v1 (existing GraphQL + UI for units/status)
- ADR-UI-Actions-and-States.md, ADR-Data-Loading-and-Pagination.md (console patterns) :contentReference[oaicite:8]{index=8}

OUTPUTS:
- runs/jira-endpoint-template-v1/PLAN.md
- runs/jira-endpoint-template-v1/LOG.md (heartbeat 10–15 min)
- runs/jira-endpoint-template-v1/QUESTIONS.md
- runs/jira-endpoint-template-v1/DECISIONS.md
- runs/jira-endpoint-template-v1/TODO.md
- Code + tests turning AC green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC/commit; reference AC#)

GUARDRAILS:
- Additive GraphQL only.
- Secrets redacted; scope enforced.
- Keep `make ci-check` < 8 minutes.
- Reuse existing console hooks (debounce, keep-previous-data, toasts). 

TASKS:
1) Add `http.jira` template (descriptor + capability flags) and form validation in Register flow.
2) Implement Test Connection (call `/rest/api/3/myself`).
3) Implement Jira driver’s `listUnits` and bind to `ingestionUnits`.
4) Ingestion page: render units and guard Run (disabled/tooltip).
5) Tests: AC1–AC5 (contract+integration+e2e).
```
