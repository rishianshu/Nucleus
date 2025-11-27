## 4) `runs/cdm-core-model-and-semantic-binding-v1/RUNCARD.md`

```markdown
# Run Card — cdm-core-model-and-semantic-binding-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-core-model-and-semantic-binding-v1

SCOPE: Define CDM work models (project, user, item, comment, worklog) in a shared Python module, implement pure Jira→CDM mapping helpers, wire CDM model ids onto Jira ingestion units, and document the CDM work model & binding. Do not change ingestion workflows or sinks.

INPUTS:
- intents/cdm-core-model-and-semantic-binding-v1/INTENT.md
- intents/cdm-core-model-and-semantic-binding-v1/SPEC.md
- intents/cdm-core-model-and-semantic-binding-v1/ACCEPTANCE.md
- platform/spark-ingestion/runtime_core/*
- platform/spark-ingestion/packages/metadata-service/*
- runtime_common/endpoints/*
- docs/meta/nucleus-architecture/*
- runs/cdm-core-model-and-semantic-binding-v1/*

OUTPUTS:
- runs/cdm-core-model-and-semantic-binding-v1/PLAN.md
- runs/cdm-core-model-and-semantic-binding-v1/LOG.md
- runs/cdm-core-model-and-semantic-binding-v1/QUESTIONS.md
- runs/cdm-core-model-and-semantic-binding-v1/DECISIONS.md
- runs/cdm-core-model-and-semantic-binding-v1/TODO.md
- CDM work model module + tests
- Jira→CDM mapping module + tests
- Updated Jira ingestion unit descriptors
- Updated architecture docs

LOOP:
Plan → Implement CDM models + tests → Implement Jira→CDM mappers + tests → Wire cdm_model_id on Jira units → Update docs → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to `blocked`.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-core-model-and-semantic-binding-v1/STORY.md.

GUARDRAILS:
- Do not modify ingestion or Temporal workflow signatures.
- Do not add or change DB schemas; CDM entities live in code only for this slug.
- Do not move bulk data through TS; all heavy IO remains in Python ingestion flows.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within current time budgets.

TASKS:
1) Add `runtime_core/cdm/work.py` defining `CdmWorkProject`, `CdmWorkUser`, `CdmWorkItem`, `CdmWorkComment`, and `CdmWorkLog` plus unit tests.
2) Add `metadata_service/cdm/jira_work_mapper.py` (or equivalent) with pure Jira→CDM mapping functions and unit tests.
3) Extend Jira ingestion unit descriptors to include `cdm_model_id` for projects/issues/users and, where applicable, comments/worklogs; add unit tests to verify.
4) Create `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md` and update `ENDPOINTS.md` + `INGESTION_AND_SINKS.md` to describe the CDM work model and Jira bindings.
