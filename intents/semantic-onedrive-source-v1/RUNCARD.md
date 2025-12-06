# Run Card — semantic-onedrive-source-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-onedrive-source-v1

SCOPE: Implement a semantic OneDrive source that can be registered as an endpoint, expose docs datasets via metadata collection, ingest docs via the unified adaptive planning + Source → Staging → Sink pipeline, map them into the CDM docs model, and surface them in the CDM Docs Explorer, while keeping ingestion metadata-driven and CI green.

INPUTS:
- intents/semantic-onedrive-source-v1/INTENT.md
- intents/semantic-onedrive-source-v1/SPEC.md
- intents/semantic-onedrive-source-v1/ACCEPTANCE.md
- platform/spark-ingestion/*
- platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*
- platform/spark-ingestion/temporal/metadata_worker.py
- apps/metadata-api/src/schema.ts
- apps/metadata-api/src/ingestion/*
- apps/metadata-api/src/temporal/*
- apps/metadata-ui/*
- runtime_core/cdm/docs/*
- docs/meta/nucleus-architecture/*
- runs/semantic-onedrive-source-v1/*

OUTPUTS:
- runs/semantic-onedrive-source-v1/PLAN.md
- runs/semantic-onedrive-source-v1/LOG.md
- runs/semantic-onedrive-source-v1/QUESTIONS.md
- runs/semantic-onedrive-source-v1/DECISIONS.md
- runs/semantic-onedrive-source-v1/TODO.md
- OneDrive endpoint descriptor and implementation in Python (template, test_connection, capabilities)
- OneDrive metadata subsystem emitting catalog datasets for docs
- OneDrive ingestion strategy (planner + worker) using staging and CDM docs mappers
- GraphQL + TS wiring for OneDrive ingestion units and runs
- CDM Docs Explorer showing OneDrive docs alongside Confluence
- Updated tests (Python/TS/Playwright) and passing `pnpm ci-check`

LOOP:
Plan → Add endpoint descriptor + test_connection → Implement OneDrive metadata subsystem → Wire OneDrive units to unified ingestion planner + staging pipeline → Integrate OneDrive CDM docs mapping via the registry → Ensure CDM Docs Explorer shows OneDrive docs → Add/adjust tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 40–45 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/semantic-onedrive-source-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run with the result for `semantic-onedrive-source-v1`.
- Append a line to stories/semantic-onedrive-source-v1/STORY.md summarizing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep GraphQL schema changes additive; do not break existing queries/mutations.
- Respect the unified ingestion contracts from `ingestion-strategy-unification-v1` (adaptive planning + staging; no bulk records via Temporal).
- Keep `pnpm ci-check` runtime within current expectations.

TASKS:
1) Implement and register the OneDrive endpoint template (descriptor, fields, test_connection) and expose it through CLI and UI.
2) Implement the OneDrive metadata subsystem that emits catalog datasets for docs under a configurable root; verify via collections and Catalog UI.
3) Implement OneDrive ingestion units and planner using the unified adaptive planning interface and Source → Staging → Sink; ensure KV watermarks are used.
4) Integrate OneDrive docs with the CDM docs sink via the CDM mapper registry and verify that the CDM Docs Explorer shows OneDrive docs with correct labels and detail view.
5) Add/update Python, TS, and Playwright tests; run `pnpm ci-check` until all tests pass.
# Run Card — semantic-onedrive-source-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-onedrive-source-v1

SCOPE: Implement a semantic OneDrive source that can be registered as an endpoint, expose docs datasets via metadata collection, ingest docs via the unified adaptive planning + Source → Staging → Sink pipeline, map them into the CDM docs model, and surface them in the CDM Docs Explorer, while keeping ingestion metadata-driven and CI green.

INPUTS:
- intents/semantic-onedrive-source-v1/INTENT.md
- intents/semantic-onedrive-source-v1/SPEC.md
- intents/semantic-onedrive-source-v1/ACCEPTANCE.md
- platform/spark-ingestion/*
- platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*
- platform/spark-ingestion/temporal/metadata_worker.py
- apps/metadata-api/src/schema.ts
- apps/metadata-api/src/ingestion/*
- apps/metadata-api/src/temporal/*
- apps/metadata-ui/*
- runtime_core/cdm/docs/*
- docs/meta/nucleus-architecture/*
- runs/semantic-onedrive-source-v1/*

OUTPUTS:
- runs/semantic-onedrive-source-v1/PLAN.md
- runs/semantic-onedrive-source-v1/LOG.md
- runs/semantic-onedrive-source-v1/QUESTIONS.md
- runs/semantic-onedrive-source-v1/DECISIONS.md
- runs/semantic-onedrive-source-v1/TODO.md
- OneDrive endpoint descriptor and implementation in Python (template, test_connection, capabilities)
- OneDrive metadata subsystem emitting catalog datasets for docs
- OneDrive ingestion strategy (planner + worker) using staging and CDM docs mappers
- GraphQL + TS wiring for OneDrive ingestion units and runs
- CDM Docs Explorer showing OneDrive docs alongside Confluence
- Updated tests (Python/TS/Playwright) and passing `pnpm ci-check`

LOOP:
Plan → Add endpoint descriptor + test_connection → Implement OneDrive metadata subsystem → Wire OneDrive units to unified ingestion planner + staging pipeline → Integrate OneDrive CDM docs mapping via the registry → Ensure CDM Docs Explorer shows OneDrive docs → Add/adjust tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/semantic-onedrive-source-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run with the result for `semantic-onedrive-source-v1`.
- Append a line to stories/semantic-onedrive-source-v1/STORY.md summarizing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep GraphQL schema changes additive; do not break existing queries/mutations.
- Respect the unified ingestion contracts from `ingestion-strategy-unification-v1` (adaptive planning + staging; no bulk records via Temporal).
- Keep `pnpm ci-check` runtime within current expectations.

TASKS:
1) Implement and register the OneDrive endpoint template (descriptor, fields, test_connection) and expose it through CLI and UI.
2) Implement the OneDrive metadata subsystem that emits catalog datasets for docs under a configurable root; verify via collections and Catalog UI.
3) Implement OneDrive ingestion units and planner using the unified adaptive planning interface and Source → Staging → Sink; ensure KV watermarks are used.
4) Integrate OneDrive docs with the CDM docs sink via the CDM mapper registry and verify that the CDM Docs Explorer shows OneDrive docs with correct labels and detail view.
5) Add/update Python, TS, and Playwright tests; run `pnpm ci-check` until all tests pass.
