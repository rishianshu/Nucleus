## `intents/collection-lifecycle/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Manual trigger only affects the target endpoint
   - Type: integration + e2e  
   - Evidence:
     - Given endpoints A and B each with a collection,
     - When `triggerCollection(collectionA)` (or `triggerEndpointCollection(endpointA)`) is called,
       - Then a new `MetadataCollectionRun` row is created with `endpointId = A`,
       - And no new runs are created for endpoint B.
     - UI: Clicking “Trigger collection” on endpoint A shows a new run under A only.

2) Schedules create periodic runs for the correct endpoint
   - Type: integration (with time-skew or short-interval cron)  
   - Evidence:
     - Given a collection with `scheduleCron` set to a frequent value and `isEnabled = true`,
     - After a simulated interval, multiple `MetadataCollectionRun` rows exist for that collection/endpoint,
     - Each run transitions to a terminal state (`SUCCEEDED` or `FAILED`).

3) Failures are isolated and finite
   - Type: integration + Temporal tests  
   - Evidence:
     - Given endpoint A intentionally fails in `prepareCollectionJob` or ingestion step,
     - Runs for A eventually reach `FAILED` after bounded retries,
     - Endpoint B’s collection continues to run and complete successfully during the same period.

4) Run lifecycle uses existing activities and statuses
   - Type: integration  
   - Evidence:
     - For a successful run:
       - DB row transitions `QUEUED → RUNNING → SUCCEEDED`,
       - `markRunStarted`, `prepareCollectionJob`, `persistCatalogRecords`, and `markRunCompleted` are invoked in order.
     - For a skipped run:
       - `prepareCollectionJob` returns `{ kind: "skip" }`,
       - `markRunSkipped` is called, and status becomes `SKIPPED`.
     - For a failing run:
       - `markRunFailed` is called with a sanitized error message, and status becomes `FAILED`.

5) Collections UI shows accurate history and filters
   - Type: e2e  
   - Evidence:
     - Collections page lists runs with endpoint name, status, requestedAt/ completedAt.
     - Filters by `endpointId` and `status` correctly narrow the list.
     - Clicking a run opens a detail view or drawer with basic info and a link to the endpoint page.

6) Disabling or deleting a collection stops further runs
   - Type: integration + e2e  
   - Evidence:
     - After `updateCollection(id, { isEnabled: false })`:
       - Temporal Schedule for that collection is paused/deleted.
       - No new `MetadataCollectionRun` rows are created by schedule tick.
       - `triggerCollection(id)` fails with `E_COLLECTION_DISABLED`.
     - After `deleteCollection(id)`:
       - The collection no longer appears in `collections` query.
       - Manual trigger fails with `E_COLLECTION_NOT_FOUND`.
       - Existing run rows remain visible in `collectionRuns` and Collections UI.


⸻

