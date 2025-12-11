# Run Card — cdm-source-provenance-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-source-provenance-v1

SCOPE: Add minimal source provenance fields to CDM Work/Docs (raw source JSON, source identifier, source URL, source system) and wire Jira/Confluence/OneDrive ingestion + CDM explorers to populate and expose them. Do not implement full lineage/KG in this slug.

INPUTS:
- intents/cdm-source-provenance-v1/INTENT.md
- intents/cdm-source-provenance-v1/SPEC.md
- intents/cdm-source-provenance-v1/ACCEPTANCE.md
- CDM schemas (work/docs tables + TS row types)
- Jira/Confluence/OneDrive CDM mappers
- CDM GraphQL resolvers and explorers
- docs/meta/nucleus-architecture/CDM-*.md
- runs/cdm-source-provenance-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/cdm-source-provenance-v1/PLAN.md
- runs/cdm-source-provenance-v1/LOG.md
- runs/cdm-source-provenance-v1/QUESTIONS.md
- runs/cdm-source-provenance-v1/DECISIONS.md
- runs/cdm-source-provenance-v1/TODO.md
- Database migrations for CDM work/docs provenance fields
- Updated CDM TS row types
- Updated Jira/Confluence/OneDrive CDM mappers populating provenance fields
- Updated GraphQL/resolvers/UI to expose provenance fields (at least sourceUrl)
- Updated docs describing provenance pattern

LOOP:
Plan → Add DB migrations + TS model changes → Update mappers to populate provenance → Expose via GraphQL/UI → Write/extend tests → Update docs → Run CI.

HEARTBEAT:
Append an entry to `runs/cdm-source-provenance-v1/LOG.md` every **40–45 minutes** with:
- `timestamp` (UTC)
- `done` (what changed since last heartbeat)
- `next` (planned next steps)
- `risks` (any emerging issues)

STOP WHEN:
- All acceptance criteria in `intents/cdm-source-provenance-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/cdm-source-provenance-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` with the latest status and timestamp for `cdm-source-provenance-v1`.
- Append a brief narrative entry to `stories/cdm-source-provenance-v1/STORY.md` describing the completed work and any key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` regions.
- Keep changes additive and backward compatible for CDM and GraphQL.
- Ensure `pnpm ci-check` remains fully green.
- Avoid adding heavy backfill logic; focus on forward-fill and a light dev/test backfill if needed.

TASKS:
1) Add provenance fields (`source_system`, `source_id`, `source_url`, `raw_source`) to CDM Work/Docs tables and TS row types via migrations.
2) Update Jira/Confluence/OneDrive CDM mappers to populate these fields from UCL/source payloads, with curated `raw_source` content.
3) Expose provenance fields via GraphQL and CDM explorers (including an "Open in source" button using `sourceUrl`).
4) Update architecture docs with provenance semantics and patterns, then run `pnpm ci-check` to validate the changes.
