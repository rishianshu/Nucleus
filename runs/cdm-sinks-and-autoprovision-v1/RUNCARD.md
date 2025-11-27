## 4) `runs/cdm-sinks-and-autoprovision-v1/RUNCARD.md`

```markdown
# Run Card — cdm-sinks-and-autoprovision-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: cdm-sinks-and-autoprovision-v1

SCOPE: Introduce an internal CDM sink endpoint for work models, implement an autoprovision flow that creates CDM tables and registers them as catalog datasets, and ensure CDM-mode ingestion can write CDM rows to the new sink without affecting existing raw ingestion.

INPUTS:
- intents/cdm-sinks-and-autoprovision-v1/INTENT.md
- intents/cdm-sinks-and-autoprovision-v1/SPEC.md
- intents/cdm-sinks-and-autoprovision-v1/ACCEPTANCE.md
- intents/cdm-core-model-and-semantic-binding-v1/*
- intents/cdm-ingestion-modes-and-sinks-v1/*
- runtime_core/cdm/*
- platform/spark-ingestion/runtime_common/endpoints/*
- platform/spark-ingestion/temporal/*
- apps/metadata-api/*
- docs/meta/nucleus-architecture/*
- runs/cdm-sinks-and-autoprovision-v1/*

OUTPUTS:
- runs/cdm-sinks-and-autoprovision-v1/PLAN.md
- runs/cdm-sinks-and-autoprovision-v1/LOG.md
- runs/cdm-sinks-and-autoprovision-v1/QUESTIONS.md
- runs/cdm-sinks-and-autoprovision-v1/DECISIONS.md
- runs/cdm-sinks-and-autoprovision-v1/TODO.md
- Code + tests + docs satisfying the acceptance criteria

LOOP:
Plan → Implement CDM sink endpoint template → Implement autoprovision (DDL + metadata registration) → Wire ingestion worker to write CDM rows to sink → Add tests → Heartbeat (≤ ~150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 minutes with {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks are green, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/cdm-sinks-and-autoprovision-v1/STORY.md.

GUARDRAILS:
- Do not break existing raw sinks or ingestion flows.
- Do not change Temporal workflow signatures beyond adding non-breaking config fields if necessary.
- Keep autoprovision idempotent and safe to re-run.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within existing runtime budgets.

TASKS:
1) Add a CDM sink endpoint template with CDM capabilities and basic write path.
2) Implement autoprovision for at least `cdm.work.item` + one more CDM model (e.g., comment), including DDL and idempotence.
3) Integrate autoprovision with metadata catalog so new CDM tables are discoverable as datasets.
4) Wire CDM-mode ingestion to write to the CDM sink and add tests to verify end-to-end behavior and compatibility with raw ingestion.
