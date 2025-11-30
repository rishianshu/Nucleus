# Run Card — confluence-ingestion-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: confluence-ingestion-v1

SCOPE: Implement Confluence ingestion units and handlers so that Confluence content (pages, optionally attachments) can be ingested via the existing ingestion core into sinks, including the docs CDM sink in `cdm` mode, with simple per-space filters and incremental behavior.

INPUTS:
- intents/confluence-ingestion-v1/INTENT.md
- intents/confluence-ingestion-v1/SPEC.md
- intents/confluence-ingestion-v1/ACCEPTANCE.md
- platform/spark-ingestion/temporal/*
- platform/spark-ingestion/runtime_common/endpoints/*
- platform/spark-ingestion/packages/metadata-service/*
- apps/metadata-api/*
- apps/metadata-ui/*
- runtime_core/cdm/docs.py and Confluence CDM mappers
- docs/meta/nucleus-architecture/*
- runs/confluence-ingestion-v1/*

OUTPUTS:
- runs/confluence-ingestion-v1/PLAN.md
- runs/confluence-ingestion-v1/LOG.md
- runs/confluence-ingestion-v1/QUESTIONS.md
- runs/confluence-ingestion-v1/DECISIONS.md
- runs/confluence-ingestion-v1/TODO.md
- Code changes (Python, TS/GraphQL, UI) implementing Confluence ingestion units, handlers, and config.
- Tests (Python unit/integration, TS/GraphQL, Playwright) and updated docs.

LOOP:
Plan → Extend ingestion unit/config model for Confluence → Implement planner/strategy segments per space → Implement Python ingestion handlers (raw + CDM) → Wire to sinks → Add tests → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/confluence-ingestion-v1/STORY.md.

GUARDRAILS:
- Do not break existing Jira ingestion or metadata flows.
- Keep source-specific logic (Confluence API calls, mapping) inside Python endpoints/handlers.
- Avoid pushing large payloads through TS/GraphQL; use Source→Staging→Sink.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within existing runtime budgets.

TASKS:
1) Add Confluence-specific ingestion unit definitions and GraphQL support (including `ConfluenceIngestionFilter`).
2) Implement planner/strategy logic to create per-space ingestion segments using KV watermarks and filters.
3) Implement Python ingestion handlers for Confluence pages (and optionally attachments) in raw/CDM modes, using docs CDM mappers.
4) Wire Confluence ingestion into existing sinks (especially docs CDM sink) and ensure incremental behavior works.
5) Add tests (Python, TS/GraphQL, Playwright) and update docs/meta to describe Confluence ingestion behavior.
