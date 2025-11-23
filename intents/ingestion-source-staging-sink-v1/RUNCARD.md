### `runs/ingestion-source-staging-sink-v1/RUNCARD.md`

```markdown
# Run Card — ingestion-source-staging-sink-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-source-staging-sink-v1

SCOPE: Align ingestion-core with the canonical ingestion data-plane (SourceEndpoint → StagingProvider → SinkEndpoint) and unify around a single Python endpoint plane, while keeping GraphQL and UI surfaces stable.

INPUTS:
- intents/ingestion-source-staging-sink-v1/INTENT.md
- intents/ingestion-source-staging-sink-v1/SPEC.md
- intents/ingestion-source-staging-sink-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/MAP.md
- docs/meta/nucleus-architecture/ENDPOINTS.md
- docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- runs/ingestion-core-v1/* (for context)

OUTPUTS:
- runs/ingestion-source-staging-sink-v1/PLAN.md
- runs/ingestion-source-staging-sink-v1/LOG.md
- runs/ingestion-source-staging-sink-v1/QUESTIONS.md
- runs/ingestion-source-staging-sink-v1/DECISIONS.md
- runs/ingestion-source-staging-sink-v1/TODO.md
- docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- Updated docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- Updated ingestion-core wiring (Temporal workflow + activities) as needed

LOOP:
Plan → Survey current ingestion-core + endpoints → Draft spec doc → Update TS workflow wiring → Adjust docs/tests → Heartbeat (≤ 150 LOC/commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria in `ACCEPTANCE.md` are met, OR
- A blocking ambiguity is logged in QUESTIONS.md and STATE is set to blocked.

GUARDRAILS:
- Do not introduce a second endpoint registry in TypeScript.
- Keep GraphQL signatures for ingestion unchanged.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `make ci-check` under the existing time budget.

TASKS:
1) Survey current ingestion-core implementation (drivers/sinks, KB sink, KV checkpoints) and reconcile with existing MAP/ENDPOINTS/INGESTION docs.
2) Draft `INGESTION-SOURCE-STAGING-SINK-v1.md` describing SourceEndpoint → StagingProvider → SinkEndpoint, including StagingProvider/StagingSession interfaces.
3) Update `INGESTION_AND_SINKS.md` to de-emphasize TS `IngestionDriver`/`IngestionSink` and reference the Python ingestion worker + staging model.
4) Add/adjust Temporal activities so that `ingestionRunWorkflow` invokes a Python ingestion worker activity (no record streaming through TS), while preserving KV + Prisma state updates.
5) Run tests (`make ci-check`); update tests and docs until all ACs are satisfied.
```
