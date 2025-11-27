# Run Card — cdm-work-explorer-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-work-explorer-v1

SCOPE: Add read-only GraphQL queries and UI for exploring CDM work data (projects, items, comments, worklogs) stored in the CDM work sink, including list + detail views and basic filters.

INPUTS:
- intents/cdm-work-explorer-v1/INTENT.md
- intents/cdm-work-explorer-v1/SPEC.md
- intents/cdm-work-explorer-v1/ACCEPTANCE.md
- runtime_core/cdm/work.py
- CDM work sink tables from cdm-sinks-and-autoprovision-v1
- apps/metadata-api/*
- apps/metadata-ui/*
- docs/meta/nucleus-architecture/*
- runs/cdm-work-explorer-v1/*

OUTPUTS:
- runs/cdm-work-explorer-v1/PLAN.md
- runs/cdm-work-explorer-v1/LOG.md
- runs/cdm-work-explorer-v1/QUESTIONS.md
- runs/cdm-work-explorer-v1/DECISIONS.md
- runs/cdm-work-explorer-v1/TODO.md
- GraphQL schema + resolvers for CDM work queries
- CDM work explorer UI components
- Tests (GraphQL + Playwright)
- Updated docs

LOOP:
Plan → Implement GraphQL queries + resolvers → Implement UI list + detail views → Wire auth + navigation → Add tests (unit/integration/e2e) → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-work-explorer-v1/STORY.md.

GUARDRAILS:
- Read-only: do not implement mutations in this slug.
- Use CDM tables as the only data source; no direct Jira API calls.
- Keep `pnpm ci-check` within existing runtime budgets.
- Do not modify *_custom.* files or // @custom blocks.

TASKS:
1) Add CDM work GraphQL schema types and resolvers reading from CDM work tables.
2) Implement the `CDM → Work` UI section with project/status/search filters and item list.
3) Implement the work item detail view, including comments and worklogs.
4) Add unit/integration tests for GraphQL and Playwright tests for list + detail flows.
5) Update architecture docs summarizing the CDM work explorer and how it relates to CDM sinks and ingestion.
