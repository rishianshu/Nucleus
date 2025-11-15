runs/collection-lifecycle/RUNCARD.md

# Run Card — collection-lifecycle

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: collection-lifecycle

SCOPE: Implement only what’s required to satisfy `intents/collection-lifecycle/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/collection-lifecycle/INTENT.md
- intents/collection-lifecycle/SPEC.md
- intents/collection-lifecycle/ACCEPTANCE.md
- docs/meta/*
- runs/collection-lifecycle/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/collection-lifecycle/PLAN.md
- runs/collection-lifecycle/LOG.md (heartbeat every 10–15 minutes)
- runs/collection-lifecycle/QUESTIONS.md
- runs/collection-lifecycle/DECISIONS.md
- runs/collection-lifecycle/TODO.md
- Code + tests to turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/collection-lifecycle/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Keep `make ci-check` < 8 minutes.
- Fail-closed on ambiguity.
- Do not log secrets or connection strings.

TASKS FOR THIS RUN:
1) **Schema & Prisma**
   - Add `MetadataCollection` model (as per SPEC).
   - Add optional `collectionId` field/relation to `MetadataCollectionRun` if missing.
   - Run migrations and regenerate Prisma client.

2) **Temporal integration**
   - Implement `CollectionRunWorkflow` that:
     - Creates/uses a `MetadataCollectionRun` row.
     - Calls `markRunStarted` / `prepareCollectionJob` / external ingestion / `persistCatalogRecords` / `markRunCompleted/Failed/Skipped`.
     - Applies bounded activity retry and timeouts.
   - Implement Temporal Schedule creation/update/deletion for each `MetadataCollection` (using Temporal Schedules API).

3) **GraphQL API**
   - Add `collections`, `collection`, `collectionRuns` queries.
   - Add `createCollection`, `updateCollection`, `deleteCollection`, `triggerCollection`, `triggerEndpointCollection` mutations.
   - Ensure error codes `E_COLLECTION_NOT_FOUND`, `E_COLLECTION_DISABLED`, `E_COLLECTION_IN_PROGRESS` are returned via `extensions.code`.

4) **Endpoint & Collections UI**
   - Wire Endpoint “Trigger collection” button to `triggerEndpointCollection(endpointId)` or explicit `collectionId`.
   - Update Collections tab to use new queries and show:
     - endpoint name,
     - status,
     - timestamps,
     - filters.
   - Ensure no global “trigger all” behavior remains.

5) **Tests**
   - Integration tests for GraphQL behavior and Temporal run lifecycle.
   - Temporal unit/integration tests for isolation & retries (AC3, AC4).
   - Playwright e2e tests for Collections UI behavior and filters (AC2, AC5, AC6).

ENV / NOTES:
- Use local dev Temporal namespace and metadata Postgres instance.
- Use shortened Cron intervals (e.g. every minute) for tests if needed, and document them.
