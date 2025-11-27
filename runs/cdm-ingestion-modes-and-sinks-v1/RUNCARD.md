### 4) `runs/cdm-ingestion-modes-and-sinks-v1/RUNCARD.md`

```markdown
# Run Card — cdm-ingestion-modes-and-sinks-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-ingestion-modes-and-sinks-v1

SCOPE: Add explicit `mode = "raw" | "cdm"` to ingestion unit configs, expose a Raw vs CDM toggle in the UI for CDM-capable units, update the Python ingestion worker to apply Jira→CDM mapping only when requested, and enforce source/sink CDM capability checks.

INPUTS:
- intents/cdm-ingestion-modes-and-sinks-v1/INTENT.md
- intents/cdm-ingestion-modes-and-sinks-v1/SPEC.md
- intents/cdm-ingestion-modes-and-sinks-v1/ACCEPTANCE.md
- apps/metadata-api/*
- apps/metadata-ui/*
- platform/spark-ingestion/temporal/*
- platform/spark-ingestion/runtime_common/*
- runtime_core/cdm/*
- docs/meta/nucleus-architecture/*
- runs/cdm-ingestion-modes-and-sinks-v1/*

OUTPUTS:
- runs/cdm-ingestion-modes-and-sinks-v1/PLAN.md
- runs/cdm-ingestion-modes-and-sinks-v1/LOG.md
- runs/cdm-ingestion-modes-and-sinks-v1/QUESTIONS.md
- runs/cdm-ingestion-modes-and-sinks-v1/DECISIONS.md
- runs/cdm-ingestion-modes-and-sinks-v1/TODO.md
- Code + tests + docs to satisfy the acceptance criteria

LOOP:
Plan → Extend config models & migrations → Wire GraphQL & UI for mode/raw vs CDM → Update worker path for CDM mapping → Add tests (unit + integration/e2e) → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks are green, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-ingestion-modes-and-sinks-v1/STORY.md.

GUARDRAILS:
- Do not change Temporal workflow signatures beyond including `mode` in existing config payload structures.
- Do not move CDM mapping into TS; all record-level transformations remain in Python.
- Preserve backward compatibility for existing ingestion configs (default to raw).
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within existing runtime budgets.

TASKS:
1) Extend ingestion unit config (DB/Prisma + TS + GraphQL) with a `mode` field and default it to `"raw"` for existing configs.
2) Update metadata-ui ingestion config to show a Raw vs CDM toggle when a unit has `cdm_model_id`, and enforce sink CDM capability selection when in CDM mode.
3) Update Python ingestion worker/drivers to:
   - inspect `mode` and `cdm_model_id`,
   - apply Jira→CDM mapping only when `mode="cdm"`,
   - preserve raw behavior when `mode="raw"`.
4) Implement validation logic rejecting invalid CDM configurations (missing `cdm_model_id` or incompatible sink) and add tests.
5) Update docs to describe the CDM ingestion mode, capabilities, and current source/sink support matrix.
```
