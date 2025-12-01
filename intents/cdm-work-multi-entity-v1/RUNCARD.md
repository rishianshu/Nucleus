# Run Card — cdm-work-multi-entity-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-work-multi-entity-v1

SCOPE: Extend CDM Work to expose multiple entity types (items, comments, worklogs) and make the CDM Explorer Work tab entity‑ and dataset‑aware with proper columns and detail panels, without breaking existing Work item APIs or CDM Explorer shell behavior.

INPUTS:
- intents/cdm-work-multi-entity-v1/INTENT.md
- intents/cdm-work-multi-entity-v1/SPEC.md
- intents/cdm-work-multi-entity-v1/ACCEPTANCE.md
- intents/cdm-explorer-shell-v1/*
- apps/metadata-api/* (CDM work schema/resolvers, GraphQL)
- apps/metadata-ui/* (CDM Explorer shell + Work tab components)
- runtime_core/cdm/work/*
- runtime_common/endpoints/* (Jira catalog + CDM bindings)
- docs/meta/nucleus-architecture/*
- runs/cdm-work-multi-entity-v1/*

OUTPUTS:
- runs/cdm-work-multi-entity-v1/PLAN.md
- runs/cdm-work-multi-entity-v1/LOG.md
- runs/cdm-work-multi-entity-v1/QUESTIONS.md
- runs/cdm-work-multi-entity-v1/DECISIONS.md
- runs/cdm-work-multi-entity-v1/TODO.md
- Updated CDM Work models/mappers (items/comments/worklogs populated for Jira)
- Updated GraphQL schema/resolvers for Work multi‑entity queries and datasets
- Updated CDM Explorer Work tab UI (entity selector, dataset filter, detail panel)
- Playwright and unit/integration tests as per ACCEPTANCE

LOOP:
Plan → Extend CDM Work models/mappers → Add/adjust GraphQL queries + dataset metadata → Update Work tab UI (entity selector, dataset filter, columns, detail panel) → Wire detail actions → Add/adjust tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 40–55 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria in intents/cdm-work-multi-entity-v1/ACCEPTANCE.md are satisfied, OR
- A blocking issue is logged in QUESTIONS.md and sync/STATE.md is marked blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-work-multi-entity-v1/STORY.md.

GUARDRAILS:
- Do not remove or change existing Work item GraphQL APIs; only add fields/queries.
- Preserve current CDM Explorer shell structure and routes.
- Keep `pnpm ci-check` runtime within existing expectations.
- Do not modify *_custom.* files or // @custom blocks.

TASKS:
1) Ensure CDM Work models and Jira mappings emit populated records for items, comments, and worklogs with source metadata fields.
2) Add/extend GraphQL `CdmWorkEntityKind`, `CdmWorkDataset`, `cdmWorkDatasets`, and typed connection queries for items/comments/worklogs, with tests.
3) Update CDM Explorer Work tab UI:
   - add entity selector,
   - add dataset filter and dataset column,
   - define per‑entity column sets.
4) Implement row selection + detail panel with full CDM fields, raw payload view, and links to source system and catalog dataset.
5) Update Playwright + unit/integration tests and run `pnpm ci-check` until green.
