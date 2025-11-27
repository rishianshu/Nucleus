# Run Card — cdm-docs-model-and-semantic-binding-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-docs-model-and-semantic-binding-v1

SCOPE: Define source-agnostic CDM docs models (space, item, revision, link), implement pure mapping helpers for Confluence and OneDrive, and update architecture docs to explain how docs CDM binds into ingestion planner and sinks. No sinks, ingestion units, or UI changes in this slug.

INPUTS:
- intents/cdm-docs-model-and-semantic-binding-v1/INTENT.md
- intents/cdm-docs-model-and-semantic-binding-v1/SPEC.md
- intents/cdm-docs-model-and-semantic-binding-v1/ACCEPTANCE.md
- runtime_core/cdm/* (existing work CDM for reference)
- platform/spark-ingestion/packages/metadata-service/*
- docs/meta/nucleus-architecture/*
- runs/cdm-docs-model-and-semantic-binding-v1/*

OUTPUTS:
- runs/cdm-docs-model-and-semantic-binding-v1/PLAN.md
- runs/cdm-docs-model-and-semantic-binding-v1/LOG.md
- runs/cdm-docs-model-and-semantic-binding-v1/QUESTIONS.md
- runs/cdm-docs-model-and-semantic-binding-v1/DECISIONS.md
- runs/cdm-docs-model-and-semantic-binding-v1/TODO.md
- CDM docs model module + unit tests
- Confluence/OneDrive mapping modules + unit tests
- Updated architecture docs

LOOP:
Plan → Implement CDM docs models + tests → Implement Confluence/OneDrive mapping + tests → Update docs → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-docs-model-and-semantic-binding-v1/STORY.md.

GUARDRAILS:
- No ingestion workflow or sink changes in this slug.
- Mapping functions must be pure (no network/DB/KB calls).
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within existing runtime budgets.

TASKS:
1) Add `runtime_core/cdm/docs.py` with `CdmDocSpace`, `CdmDocItem`, `CdmDocRevision`, and `CdmDocLink` plus unit tests.
2) Add `confluence_docs_mapper.py` with Confluence→CDM mapping helpers and tests.
3) Add `onedrive_docs_mapper.py` with OneDrive→CDM mapping helpers and tests.
4) Update `CDM-DOCS-MODEL.md`, `INGESTION_AND_SINKS.md`, and endpoint HLD docs to describe the docs CDM and bindings.
