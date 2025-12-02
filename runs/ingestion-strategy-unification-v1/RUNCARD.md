# Run Card — ingestion-strategy-unification-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-strategy-unification-v1

SCOPE: Unify ingestion across JDBC, Jira, and Confluence by enforcing an adaptive planning interface, a strict Source → Staging → Sink data plane (no bulk records via Temporal), a metadata-first invariant for ingestion units, and CDM mapping via a registry, while keeping APIs backward compatible and CI green.

INPUTS:
- intents/ingestion-strategy-unification-v1/INTENT.md
- intents/ingestion-strategy-unification-v1/SPEC.md
- intents/ingestion-strategy-unification-v1/ACCEPTANCE.md
- platform/spark-ingestion/*
- platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*
- platform/spark-ingestion/temporal/metadata_worker.py
- apps/metadata-api/src/ingestion/*
- apps/metadata-api/src/temporal/*
- docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- docs/meta/nucleus-architecture/endpoint-HLD.md
- docs/meta/nucleus-architecture/cdm-mapper-refactor.md
- runs/ingestion-strategy-unification-v1/*

OUTPUTS:
- runs/ingestion-strategy-unification-v1/PLAN.md
- runs/ingestion-strategy-unification-v1/LOG.md
- runs/ingestion-strategy-unification-v1/QUESTIONS.md
- runs/ingestion-strategy-unification-v1/DECISIONS.md
- runs/ingestion-strategy-unification-v1/TODO.md
- Updated Python endpoint planners (JDBC, Jira, Confluence) implementing the unified adaptive planning interface
- Updated Python ingestion runtime / metadata_worker to use Source → Staging → Sink per unit/slice
- Updated GraphQL + Temporal ingestion workflow wiring (metadata-first validation, unified plan→execute path)
- CDM mapper registry wired into the ingestion flow; metadata_worker made endpoint-agnostic for CDM
- Updated unit, integration, and e2e tests
- `pnpm ci-check` log for this run

LOOP:
Plan → Introduce/refine adaptive planning abstractions → Adapt JDBC/Jira/Confluence planners → Enforce Source → Staging → Sink in metadata_worker and workflow → Wire CDM mapper registry and remove endpoint-specific CDM logic → Enforce metadata-first invariants in GraphQL → Align KV state usage → Update tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append only to LOG.md every 40–45 min: `{timestamp, done, next, risks}`.  
Treat the heartbeat entry as the sole routine status output and immediately continue with the recorded `next` step—no conversational “still working?” messages in the main console.
STOP WHEN:
- All acceptance criteria in intents/ingestion-strategy-unification-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run and status for `ingestion-strategy-unification-v1`.
- Append a line to stories/ingestion-strategy-unification-v1/STORY.md describing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep all GraphQL changes additive (no breaking changes to existing types/mutations).
- Preserve separation of concerns:
  - Endpoints + planners + staging/sinks in Python,
  - Orchestration, KV, and GraphQL in TypeScript,
  - KB as semantic/metadata only.
- Keep `pnpm ci-check` runtime within current expectations.

TASKS:
1) Implement/standardize adaptive planners for JDBC, Jira, and Confluence via `list_units` + `plan_incremental_slices`.
2) Enforce Source → Staging → Sink in `metadata_worker.runIngestionUnit`, returning only handles/state/stats to Temporal.
3) Refactor `ingestionRunWorkflow` + GraphQL ingestion resolvers to use a single plan→execute path and enforce metadata-first invariants with typed errors.
4) Integrate CDM mapper registry; remove Jira/Confluence-specific CDM branches from metadata_worker and route CDM mode through `apply_cdm(...)`.
5) Align KV checkpoint state shapes and usage across planners; update unit/integration/Playwright tests and run `pnpm ci-check` until green.
