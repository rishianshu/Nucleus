## `runs/ingestion-core-v1/RUNCARD.md`

```markdown
# Run Card — ingestion-core-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-core-v1

SCOPE: Implement generic ingestion foundation (drivers/units, KV checkpoints, Temporal workflow, pluggable sinks with KB default, GraphQL control/status, admin UI) so that `intents/ingestion-core-v1/ACCEPTANCE.md` passes. No vendor drivers in this run.

INPUTS:
- intents/ingestion-core-v1/INTENT.md
- intents/ingestion-core-v1/SPEC.md
- intents/ingestion-core-v1/ACCEPTANCE.md
- docs/meta/ADR-UI-Actions-and-States.md
- docs/meta/ADR-Data-Loading-and-Pagination.md

OUTPUTS:
- runs/ingestion-core-v1/PLAN.md
- runs/ingestion-core-v1/LOG.md (heartbeat every 10–15 min)
- runs/ingestion-core-v1/QUESTIONS.md
- runs/ingestion-core-v1/DECISIONS.md
- runs/ingestion-core-v1/TODO.md
- Code + tests (contract, integration, e2e) to turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC/commit; reference AC#)

GUARDRAILS:
- Additive GraphQL only; short-lived workflows (no daemons).
- KV checkpoints idempotent; provenance/scopes in sink calls.
- UI uses ADR patterns: debounced inputs, *keep-previous-data*, cursor pagination, action toasts. :contentReference[oaicite:11]{index=11}
- `make ci-check` < 8 minutes.

TASKS:
1) Define `IngestionDriver` & `NormalizedRecord`/`Batch`.
2) Implement KV helpers for checkpoints.
3) Build `IngestWorkflow` + activities (load→sync→write→advance) with retries/backoff/timeouts.
4) Implement sink registry + default KB sink.
5) Add GraphQL: units/start/pause/reset/status (admin).
6) Build Ingestion admin page skeleton; wire ADR data-loading & action feedback.
7) Tests: AC1–AC6 (contract/integration/e2e).
```

