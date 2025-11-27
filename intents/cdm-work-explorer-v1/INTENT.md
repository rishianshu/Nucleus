- title: CDM work explorer v1
- slug: cdm-work-explorer-v1
- type: feature
- context:
  - apps/metadata-api/src/cdm/*
  - apps/metadata-ui/src/features/cdm/*
  - runtime_core/cdm/work.py
  - cdm work sink tables (Postgres) from cdm-sinks-and-autoprovision-v1
  - docs/meta/nucleus-architecture/*
- why_now: CDM work entities (projects, users, items, comments, worklogs) are now mapped from Jira and written into a CDM sink. However, there is no first-class way to explore this data in the Nucleus UI or via GraphQL. CDM remains opaque, making it hard to validate ingestion, debug mapping, or use CDM as a foundation for downstream apps. We need a minimal, read-only CDM work explorer: list + filters + detail view.
- scope_in:
  - Add GraphQL queries to read CDM work entities (projects, items, item detail with comments/worklogs) from the CDM sink tables.
  - Add a new “CDM → Work” section in the metadata UI with:
    - a project-aware work items list (basic filters: project, status, text search),
    - a work item detail view with core fields and tabs for comments and worklogs.
  - Hook CDM work explorer into existing auth/roles (same as ingestion/metadata console).
  - Add tests (GraphQL unit/integration + Playwright e2e) to cover list and detail flows.
- scope_out:
  - Editing CDM data (no mutations; read-only explorer).
  - Advanced analytics (metrics, charts, burndown, etc.).
  - Non-work CDM domains (docs, people) and cross-source correlation.
- acceptance:
  1. GraphQL exposes CDM work queries that return projects, paginated work items, and a single work item with comments/worklogs.
  2. A “CDM → Work” UI section lists work items with basic filters and links to a detail view.
  3. The work item detail view surfaces key fields plus comments/worklogs from CDM tables.
  4. At least one e2e test uses seeded/ingested Jira data to exercise list + detail and asserts that CDM rows are visible.
- constraints:
  - Read-only: no mutations in this slug.
  - Reuse existing Postgres/CDM sink; no new storage.
  - Respect existing auth pattern (viewer/admin roles from Keycloak).
- non_negotiables:
  - Explorer must read from CDM tables, not from Jira APIs or KB.
  - Failure states (no CDM data, empty filters) must be handled with clear UX (empty states, not crashes).
- refs:
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-ingestion-modes-and-sinks-v1/*
  - intents/cdm-sinks-and-autoprovision-v1/*
  - docs/meta/nucleus-architecture/CDM-WORK-MODEL.md
  - docs/meta/nucleus-architecture/CDM-WORK-SINK.md
- status: in-progress
