- title: Collection lifecycle (per-endpoint schedules & runs)
- slug: collection-lifecycle
- type: feature
- context:
  - apps/metadata-api (GraphQL schema/resolvers, Prisma models, Temporal client)
  - apps/metadata-console (Collections view, Endpoint “Trigger collection” actions)
  - temporal/ (workflows using activities.ts)
- why_now: Collections are currently naive: triggering from one endpoint can affect others, there is no per-endpoint schedule, and Temporal runs lack clear retry/timeout/isolated behavior. We need a robust collection lifecycle so each endpoint has safe, observable, and schedulable metadata runs that power Nucleus’ catalog domains.
- scope_in:
  - Introduce a per-endpoint **Collection** handle stored in a separate table (e.g. `MetadataCollection`) that owns schedule config and links to runs.
  - Use **Temporal Schedules** (not long-running workflows) to trigger `CollectionRunWorkflow` executions for each collection.
  - Support **manual triggers** that start a single workflow run for a single collection.
  - Ensure each run:
    - uses existing metadata activities (`markRunStarted`, `prepareCollectionJob`, `persistCatalogRecords`, `markRunCompleted/Failed/Skipped`),
    - creates/updates `MetadataCollectionRun` rows with correct statuses.
  - Collections UI:
    - show run history (per endpoint and global list),
    - filter by endpoint and status,
    - link from Endpoint card/button to “Runs for this endpoint”.
  - Guardrails:
    - One active run per collection at a time,
    - Failures on one endpoint do not block others,
    - Bounded retries and timeouts for activities.
- scope_out:
  - Dataset preview/profile workflows (separate slug)
  - Endpoint detail page v2 with rich history and scheduling (separate slug)
  - CDM/domain-level modeling for Workspace (work items, Jira, etc.)
- acceptance:
  1. Triggering a collection (API/UI) creates a run only for that endpoint and never triggers runs for other endpoints.
  2. A configured schedule for a collection triggers periodic runs that create `MetadataCollectionRun` rows at the expected cadence.
  3. Failures in one endpoint’s runs do not prevent collections from running successfully for other endpoints.
  4. Each run transitions through `QUEUED → RUNNING → SUCCEEDED/FAILED/SKIPPED` using the existing activities pipeline.
  5. Collections UI lists run history with filters by endpoint and status and links to endpoints.
  6. Disabling or deleting a collection stops future scheduled runs and blocks manual triggers while preserving existing run history.
- constraints:
  - Backwards compatible GraphQL API (existing trigger-by-endpoint behavior must keep working, even if internally routed via collections).
  - Additive DB migrations only (new tables/columns; no destructive changes).
  - Temporal workflows must be idempotent and safe to retry (no duplicate catalog records for the same run).
  - No secrets (passwords/DSNs) in logs or `error` fields.
  - `make ci-check` < 8 minutes.
- non_negotiables:
  - Triggering a collection for endpoint A must never cause runs for endpoint B.
  - No unbounded retries; all workflows/activities have bounded retry policies and timeouts.
  - Collections and runs must remain queryable for debugging even after schedules are disabled.
- refs:
  - apps/metadata-api/src/temporal/activities.ts (markRun*/prepareCollectionJob/persistCatalogRecords)
  - Existing `MetadataEndpoint` and `MetadataCollectionRun` Prisma models
  - Current Collections and Endpoints pages in metadata console
- status: in-progress
