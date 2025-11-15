intents/collection-lifecycle/SPEC.md

# SPEC — Collection lifecycle (per-endpoint schedules & runs)

## Problem
Collections today are naive: triggering one endpoint can affect others, there is no per-endpoint schedule abstraction, and Temporal runs do not enforce clear retry/timeout/isolation behavior. We need a robust collection lifecycle where each endpoint has a **Collection** handle with its own schedule, runs are executed via Temporal **per run**, and UI shows accurate history.

## Interfaces / Contracts

### GraphQL Types

We introduce a `MetadataCollection` table and expose it via GraphQL, without breaking existing run types.

```graphql
type MetadataCollection {
  id: ID!
  endpointId: ID!
  endpoint: MetadataEndpoint!
  scheduleCron: String        # null = manual only
  scheduleTimezone: String    # e.g. "Asia/Kolkata"
  isEnabled: Boolean!
  temporalScheduleId: String  # ID used in Temporal Schedules API
  createdAt: DateTime!
  updatedAt: DateTime!
}

MetadataCollectionRun already exists and is extended (if needed) with an optional collectionId:

type MetadataCollectionRun {
  id: ID!
  collectionId: ID
  endpointId: ID!
  endpoint: MetadataEndpoint!
  status: MetadataCollectionStatus!
  requestedBy: String
  requestedAt: DateTime!
  startedAt: DateTime
  completedAt: DateTime
  workflowId: String
  temporalRunId: String
  error: String
  filters: JSON
  createdAt: DateTime!
  updatedAt: DateTime!
}

GraphQL Queries

type Query {
  collections(
    endpointId: ID
    isEnabled: Boolean
    first: Int = 50
    after: String
  ): [MetadataCollection!]!

  collection(id: ID!): MetadataCollection

  collectionRuns(
    endpointId: ID
    collectionId: ID
    status: MetadataCollectionStatus
    from: DateTime
    to: DateTime
    first: Int = 50
    after: String
  ): [MetadataCollectionRun!]!
}

GraphQL Mutations

input CollectionCreateInput {
  endpointId: ID!
  scheduleCron: String
  scheduleTimezone: String = "UTC"
  isEnabled: Boolean = true
}

input CollectionUpdateInput {
  scheduleCron: String
  scheduleTimezone: String
  isEnabled: Boolean
}

type Mutation {
  createCollection(input: CollectionCreateInput!): MetadataCollection!
  updateCollection(id: ID!, input: CollectionUpdateInput!): MetadataCollection!
  deleteCollection(id: ID!): Boolean!

  triggerCollection(collectionId: ID!): MetadataCollectionRun!

  # Backwards-compatible endpoint-based trigger
  triggerEndpointCollection(endpointId: ID!): MetadataCollectionRun!
}

Behavior notes:
	•	triggerCollection(collectionId):
	•	Finds the collection, validates isEnabled = true.
	•	Creates a MetadataCollectionRun row in QUEUED.
	•	Starts a Temporal workflow run (CollectionRunWorkflow) with { runId, endpointId, collectionId }.
	•	triggerEndpointCollection(endpointId):
	•	Convenience wrapper that finds the collection associated with the endpoint (if only one) and calls triggerCollection.
	•	If no collection exists, implementation may create a default manual-only collection or error; acceptance will define the expected behavior.

Error Model

Errors exposed via extensions.code:
	•	E_COLLECTION_NOT_FOUND — invalid collectionId
	•	E_COLLECTION_DISABLED — collection exists but isEnabled = false
	•	E_COLLECTION_IN_PROGRESS — a run is already RUNNING for this collection
	•	E_ENDPOINT_NOT_FOUND — invalid endpointId
	•	Existing auth errors: E_AUTH_REQUIRED, E_ROLE_FORBIDDEN

Temporal: Schedules + Workflows

We use Temporal Schedules and per-run workflows, no long-running orchestrators.
	•	Schedule ID: collection::<collectionId>
	•	Workflow type: CollectionRunWorkflow
	•	Workflow ID: collection-run::<runId> (unique per run)

Temporal Schedules
	•	createCollection:
	•	If scheduleCron is provided and isEnabled = true, create a Temporal Schedule with ID collection::<collectionId> that runs CollectionRunWorkflow on the given cron.
	•	updateCollection:
	•	If scheduleCron changes or isEnabled toggles, update or pause/resume the Temporal Schedule.
	•	deleteCollection:
	•	Disable/delete the Temporal Schedule and mark isEnabled=false.

CollectionRunWorkflow
Signature (conceptual):

interface CollectionRunInput {
  runId: string;
  endpointId: string;
  collectionId?: string;
}

async function CollectionRunWorkflow(input: CollectionRunInput) {
  // 1) mark run started
  // 2) prepare job
  // 3) if job.kind === "skip": markRunSkipped
  // 4) else: invoke external ingestion (Spark), then persistCatalogRecords
  // 5) mark run completed or failed
}

Workflow steps:
	1.	Call markRunStarted({ runId, workflowId, temporalRunId }).
	2.	Call prepareCollectionJob({ runId }):
	•	If { kind: "skip" } → markRunSkipped({ runId, reason }).
	•	If { kind: "run", job }:
	•	Invoke Spark ingestion (via existing CLI: endpoint_registry_cli.py / spark-ingestion stack) out-of-process.
	•	Wait for ingestion to finish (with timeout).
	3.	Call persistCatalogRecords({ runId, records?, recordsPath? }) to upsert MetadataRecord + graph.
	4.	On success → markRunCompleted({ runId }).
	5.	On error (any step) → markRunFailed({ runId, error }).

Retry & timeout:
	•	Activities (mark*, prepareCollectionJob, persistCatalogRecords, ingestion wrapper) must have bounded retry policies and timeouts.
	•	Workflow-level retry should be conservative; most logic should be in activity retries.

Data & State

Prisma Models (conceptual)

New table:

model MetadataCollection {
  id                String           @id @default(uuid())
  endpointId        String
  endpoint          MetadataEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  scheduleCron      String?
  scheduleTimezone  String?          @default("UTC")
  isEnabled         Boolean          @default(true)
  temporalScheduleId String?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  runs              MetadataCollectionRun[]
}

Extend MetadataCollectionRun (add optional foreign key, if not already present):

model MetadataCollectionRun {
  id            String                     @id @default(uuid())
  collectionId  String?
  collection    MetadataCollection?        @relation(fields: [collectionId], references: [id], onDelete: SetNull)
  endpointId    String
  endpoint      MetadataEndpoint           @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  status        MetadataCollectionStatus   @default(QUEUED)
  requestedBy   String?
  requestedAt   DateTime                   @default(now())
  startedAt     DateTime?
  completedAt   DateTime?
  workflowId    String?
  temporalRunId String?
  error         String?
  filters       Json?
  createdAt     DateTime                   @default(now())
  updatedAt     DateTime                   @updatedAt

  @@index([collectionId])
  @@index([endpointId])
}

State invariants:
	•	Each MetadataCollection can have zero or one active Temporal Schedule (represented by temporalScheduleId).
	•	At most one RUNNING run per collection at a time (enforced via application logic).
	•	MetadataRecord already stores dataset metadata and includes labels like endpoint:<id> and source:<sourceId> from persistCatalogRecords — no change required here.

Constraints
	•	No breaking changes to existing GraphQL fields; new fields and mutations are additive.
	•	Temporal Schedules must be created/updated/deleted idempotently:
	•	Running createCollection twice should not create duplicate schedules.
	•	Workflows must be idempotent per runId:
	•	Re-running the same runId (due to retry or duplication) must not create duplicate metadata or runs.
	•	All logs and error fields must avoid including sensitive connection details (use generic messages or sanitize).

Acceptance Mapping
	•	AC1 → triggerCollection and triggerEndpointCollection behavior (per-endpoint, no cross-triggering) + UI check on Endpoint “Trigger collection”.
	•	AC2 → Temporal Schedules + MetadataCollectionSchedule semantics tested via time-skewed or short-interval schedules.
	•	AC3 → Temporal tests with a failing endpoint and a healthy one to show isolation.
	•	AC4 → Workflow/activities pipeline calling markRunStarted/Completed/Failed/Skipped, and status transitions in DB.
	•	AC5 → Collections UI consuming collections / collectionRuns queries to show history and filters.
	•	AC6 → Disabling/deleting a collection and verifying that schedules are removed/paused and manual trigger blocked.

Risks / Open Questions
	•	R1: Misconfigured scheduleCron could cause overly frequent runs; mitigated via validation and a minimum allowed interval.
	•	R2: External ingestion step (Spark/Python) may take unpredictable time; need a safe timeout and user-visible error when exceeded.
	•	Q1: What is the expected behavior of triggerEndpointCollection when an endpoint has multiple collections? For now, spec assumes “at most one collection per endpoint”; if this changes, the API must support disambiguation.
	•	Q2: Should disabling a collection allow a “manual run” override, or should disabled mean “no runs at all”? Current acceptance assumes disabled = no runs.

---

