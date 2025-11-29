# Run Card — semantic-confluence-source-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-confluence-source-v1

SCOPE: Add a Confluence HTTP endpoint template with metadata + preview capabilities, wire it into the endpoint registry and metadata worker, and ensure Confluence spaces/pages/attachments appear as catalog datasets with working preview in the Metadata UI.

INPUTS:
- intents/semantic-confluence-source-v1/INTENT.md
- intents/semantic-confluence-source-v1/SPEC.md
- intents/semantic-confluence-source-v1/ACCEPTANCE.md
- runtime_common/endpoints/* (HTTP/semantic endpoints, Jira endpoint)
- platform/spark-ingestion/packages/metadata-service/*
- platform/spark-ingestion/temporal/*
- apps/metadata-api/*
- apps/metadata-ui/*
- docs/meta/nucleus-architecture/*
- runs/semantic-confluence-source-v1/*

OUTPUTS:
- runs/semantic-confluence-source-v1/PLAN.md
- runs/semantic-confluence-source-v1/LOG.md
- runs/semantic-confluence-source-v1/QUESTIONS.md
- runs/semantic-confluence-source-v1/DECISIONS.md
- runs/semantic-confluence-source-v1/TODO.md
- Confluence endpoint template + metadata subsystem (Python)
- Updated endpoint registry and planner hooks
- Updated GraphQL/TS schemas & resolvers for endpoint registration/collections
- Catalog + preview integration
- Tests (Python, TS/GraphQL, Playwright) and docs updates

LOOP:
Plan → Implement endpoint descriptor + metadata subsystem → Hook into planner + worker → Expose template in GraphQL/Metadata UI → Wire catalog + preview → Add tests → Heartbeat.

HEARTBEAT:
Append to LOG.md every 40–45 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria in intents/semantic-confluence-source-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/semantic-confluence-source-v1/STORY.md.

GUARDRAILS:
- Do not break existing endpoints or metadata workflows.
- Keep Confluence-specific logic inside the Confluence endpoint/metadata subsystem as much as possible.
- Use existing Source → Staging → Sink pattern; no heavy data flows in TS/GraphQL.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within existing runtime budgets.

TASKS:
1) Implement the Confluence endpoint template and metadata subsystem (spaces/pages/attachments) and register it.
2) Wire planner/worker so metadata collections for `http.confluence` endpoints fetch and emit normalized Confluence metadata.
3) Update catalog integration to show Confluence datasets, and implement preview for Confluence pages.
4) Add Python, TS/GraphQL, and Playwright tests covering the end-to-end flow; update docs/meta to reflect the new semantic source.
