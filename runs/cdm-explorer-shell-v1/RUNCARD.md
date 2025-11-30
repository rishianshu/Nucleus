# Run Card — cdm-explorer-shell-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-explorer-shell-v1

SCOPE: Refactor the existing Work CDM explorer into a generic CDM Explorer shell with domain plugins, add a Docs CDM view, and introduce a generic CDM entity GraphQL envelope, without breaking existing work CDM APIs or behavior.

INPUTS:
- intents/cdm-explorer-shell-v1/INTENT.md
- intents/cdm-explorer-shell-v1/SPEC.md
- intents/cdm-explorer-shell-v1/ACCEPTANCE.md
- apps/metadata-ui/* (CDM work explorer, navigation shell)
- apps/metadata-api/* (CDM work resolvers, GraphQL schema)
- runtime_core/cdm/* (work + docs models)
- docs/meta/nucleus-architecture/*
- runs/cdm-explorer-shell-v1/*

OUTPUTS:
- runs/cdm-explorer-shell-v1/PLAN.md
- runs/cdm-explorer-shell-v1/LOG.md
- runs/cdm-explorer-shell-v1/QUESTIONS.md
- runs/cdm-explorer-shell-v1/DECISIONS.md
- runs/cdm-explorer-shell-v1/TODO.md
- Updated GraphQL schema/resolvers (CDM entity envelope + CDM Explorer queries)
- Updated Metadata UI (CDM Explorer shell + Work/Docs tabs)
- Tests (TS/unit, GraphQL resolver tests, Playwright e2e) and docs updates

LOOP:
Plan → Add generic GraphQL CDM entity envelope → Refactor Work Explorer into shell plugin → Add Docs plugin + tab → Wire shell to envelope queries → Add/adjust tests → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria in intents/cdm-explorer-shell-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-explorer-shell-v1/STORY.md.

GUARDRAILS:
- Do not remove or break existing work CDM queries; keep them for detail views/tests.
- Avoid magic source-specific logic in the shell; keep domain-specific behavior in plugins.
- Keep `pnpm ci-check` within existing runtime budgets.
- Do not modify *_custom.* files or // @custom blocks.

TASKS:
1) Introduce `CdmEntity` GraphQL envelope and `cdmEntities`/`cdmEntity` queries backed by existing CDM sinks.
2) Add a CDM Explorer route + shell component, wiring the Work CDM explorer into it as a domain plugin.
3) Implement a basic Docs CDM plugin for `DOC_ITEM` domain and integrate it into the shell as a Docs tab.
4) Update Playwright + unit/integration tests to cover the new shell, ensure Work behavior is preserved, and Docs view renders CDM docs data.
5) Update architecture docs to describe the CDM Explorer shell and how new domains/sources (e.g., GitHub) plug in.
