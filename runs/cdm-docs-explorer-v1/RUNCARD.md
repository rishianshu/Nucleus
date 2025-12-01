# Run Card — cdm-docs-explorer-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-docs-explorer-v1

SCOPE: Implement a CDM Docs explorer tab that surfaces CDM documents (Confluence, OneDrive, etc.) with dataset/source awareness, filters, and a detail panel, using additive GraphQL changes and the existing CDM Explorer shell.

INPUTS:
- intents/cdm-docs-explorer-v1/INTENT.md
- intents/cdm-docs-explorer-v1/SPEC.md
- intents/cdm-docs-explorer-v1/ACCEPTANCE.md
- apps/metadata-api/* (CDM GraphQL schema & resolvers for docs)
- apps/metadata-ui/* (CDM Explorer shell, Docs tab components)
- runtime_core/cdm/docs/* (CDM docs entities)
- runtime_common/endpoints/* (semantic Confluence / OneDrive endpoints)
- ingestion metadata (CDM sinks, units)
- runs/cdm-docs-explorer-v1/*

OUTPUTS:
- runs/cdm-docs-explorer-v1/PLAN.md
- runs/cdm-docs-explorer-v1/LOG.md
- runs/cdm-docs-explorer-v1/QUESTIONS.md
- runs/cdm-docs-explorer-v1/DECISIONS.md
- runs/cdm-docs-explorer-v1/TODO.md
- Updated CDM GraphQL schema/resolvers for docs fields & `cdmDocsDatasets`
- Updated CDM Explorer Docs UI (filters, table, detail panel)
- Unit/integration + Playwright tests
- Any small doc updates needed to reflect the new explorer

LOOP:
Plan → Extend CDM docs GraphQL (fields, filters, datasets query) → Implement docs resolver mappings → Build Docs tab UI (filters, table, detail panel) → Seed / verify Confluence docs via harness → Add tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 40–45 minutes: {timestamp, done, next, risks}.
Treat the heartbeat entry as the sole routine status output and immediately continue with the recorded `next` step—no conversational “still working?” messages in the main console.

STOP WHEN:
- All acceptance criteria in intents/cdm-docs-explorer-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-docs-explorer-v1/STORY.md.

GUARDRAILS:
- GraphQL: only additive changes; do not remove/rename existing fields or queries.
- CDM Explorer shell: reuse the existing patterns (no one-off UI islands).
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` runtime within existing expectations.

TASKS:
1) Extend `CdmEntity` and `CdmEntityFilter` with docs-specific fields and filters; implement `cdmDocsDatasets` query.
2) Map Confluence CDM docs into these fields in the docs resolvers; ensure dataset/source metadata is present.
3) Implement Docs tab UI:
   - Dataset & source filters,
   - Search bar,
   - Docs table with appropriate columns.
4) Implement a detail panel for docs with metadata, content excerpt, raw JSON, and “open in source/dataset” actions.
5) Add/update unit, integration, and Playwright tests; run `pnpm ci-check` until green.