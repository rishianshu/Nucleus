- title: Ingestion filters & incremental Jira v1
- slug: ingestion-filters-and-incremental-jira-v1
- type: feature
- context:
  - apps/metadata-api (GraphQL ingestion config, Prisma models)
  - apps/metadata-ui (ingestion config UI)
  - platform/spark-ingestion/temporal/ingestion_worker.py
  - platform/spark-ingestion/runtime_common/endpoints/jira_* (Jira endpoint + ingestion units)
  - runtime_core/cdm/* (existing Jira CDM mappers)
  - KV store + ingestion state helpers
- why_now: Downstream CDM and CDM sinks are live, but ingestion is still too naive for real Jira usage. We need metadata-driven filters (projects, users, statuses) that can evolve over time, and robust incremental ingestion at endpoint level (pagination + per-dimension cursors + restart safety). Without this, adding or changing filters either forces full reloads or requires bespoke hacks per endpoint.
- scope_in:
  - Define a generic ingestion filter contract (per unit) and persist it in ingestion config.
  - Extend Jira metadata so ingestion filters can reference projects/users/statuses from catalog/metadata, not hardcoded lists.
  - Implement incremental ingestion semantics for Jira units, including:
    - per-dimension cursors (e.g. per project or per key),
    - handling of filter changes without full reload.
  - Introduce a transient state abstraction for endpoints, backed by KV, to hold pagination cursors and run-level state.
- scope_out:
  - UI for advanced JQL-like expression building (basic structured filters only for v1).
  - Parallel partition orchestration beyond a single worker per unit (future scaling slug).
  - Non-Jira endpoints (pattern should be generic, but this slug only implements Jira).
- acceptance:
  1. Ingestion config supports a structured filter object per unit and persists it.
  2. Jira metadata exposes the project/user/status dimensions ingestion needs to build filters.
  3. Jira ingestion implements incremental behavior using per-dimension cursors stored via a transient state abstraction.
  4. Changing filters (e.g., adding a project) causes new dimensions to ingest from inception (or configured initial-from) while existing dimensions continue from their cursors, without forcing full reload.
- constraints:
  - No breaking changes to existing ingestion API signatures; additions must be backward compatible.
  - Legacy configs without filters behave as “no filter” (ingest all) plus current incremental behavior.
- non_negotiables:
  - Endpoint code must not hardcode filters; all filter behavior flows from ingestion config.
  - Transient state must be recoverable on retry and safe for idempotent runs (KV-backed).
- refs:
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/jira-metadata-HLD.md
  - docs/meta/nucleus-architecture/jira-metadata-LLD.md
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-ingestion-modes-and-sinks-v1/*
- status: in-progress
