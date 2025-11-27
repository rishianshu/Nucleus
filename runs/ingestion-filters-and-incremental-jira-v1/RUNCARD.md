### `runs/ingestion-filters-and-incremental-jira-v1/RUNCARD.md`

```markdown
# Run Card — ingestion-filters-and-incremental-jira-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-filters-and-incremental-jira-v1

SCOPE: Add metadata-driven filters and robust incremental ingestion for Jira units, including per-dimension cursors and a KV-backed transient state abstraction for endpoints, without breaking existing ingestion flows.

INPUTS:
- intents/ingestion-filters-and-incremental-jira-v1/INTENT.md
- intents/ingestion-filters-and-incremental-jira-v1/SPEC.md
- intents/ingestion-filters-and-incremental-jira-v1/ACCEPTANCE.md
- apps/metadata-api/*
- apps/metadata-ui/*
- platform/spark-ingestion/temporal/*
- platform/spark-ingestion/runtime_common/endpoints/jira_*
- runtime_core/cdm/*
- KV store abstraction for ingestion state
- docs/meta/nucleus-architecture/*
- runs/ingestion-filters-and-incremental-jira-v1/*

OUTPUTS:
- runs/ingestion-filters-and-incremental-jira-v1/PLAN.md
- runs/ingestion-filters-and-incremental-jira-v1/LOG.md
- runs/ingestion-filters-and-incremental-jira-v1/QUESTIONS.md
- runs/ingestion-filters-and-incremental-jira-v1/DECISIONS.md
- runs/ingestion-filters-and-incremental-jira-v1/TODO.md
- Code + tests + docs satisfying the acceptance criteria

LOOP:
Plan → Extend ingestion config models & GraphQL with filters → Wire UI to Jira metadata → Add TransientState abstraction & wire Jira endpoint → Implement per-dimension incremental behavior → Add tests → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/ingestion-filters-and-incremental-jira-v1/STORY.md.

GUARDRAILS:
- Backward compatible: existing ingestion configs must remain valid and behave as before.
- Do not move heavy data into TS/GraphQL; all record-level work stays in Python.
- Keep `pnpm ci-check` within existing runtime budgets.
- Do not modify *_custom.* files or // @custom blocks.

TASKS:
1) Extend ingestion unit config + GraphQL with `JiraIngestionFilter` and persist it.
2) Wire metadata-ui ingestion screens to Jira metadata so filters are driven by projects/users/statuses.
3) Implement KV-backed `TransientState` abstraction and integrate it into Jira ingestion endpoint.
4) Implement per-project incremental cursors and ensure filter changes behave as specified.
5) Add unit/integration/e2e tests and update ingestion/endpoint docs to describe the new filter + incremental semantics.
