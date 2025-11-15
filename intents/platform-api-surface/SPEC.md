# Spec: Platform API Surface

## Context & Goal
- Define the public API surfaces (GraphQL and limited REST) for interacting with entities, edges, searches, workflows, annotations, and KV checkpoints.
- Provide consistent operation naming, payload fields, idempotency rules, and pagination expectations without diving into SDL or code.

## GraphQL Operations

### Query `metaEntities`
- **Purpose**: Retrieve entity descriptors filtered by tenant, project, type, or search terms.
- **Inputs**: `filter` object (fields: `tenantId`, `projectId`, `entityIds`, `entityTypes`, `searchText`), `pagination` (`after`, `limit`).
- **Outputs**: `entities` list with fields `entityId`, `entityType`, `displayName`, `canonicalPath`, `specRef`, `owners`, `createdAt`, `updatedAt`, `version`.
- **Notes**: Cursor-based pagination; `after` token encodes entity ID and version. Idempotent read.

### Query `metaEdges`
- **Purpose**: Inspect relationships between entities.
- **Inputs**: `sourceIds`, `targetIds`, `edgeTypes`, `tenantId`, `projectId`, `pagination`.
- **Outputs**: `edges` list with fields `edgeId`, `edgeType`, `sourceEntityId`, `targetEntityId`, `confidence`, `metadata`, `specRef`, `createdAt`.
- **Notes**: Supports pagination; idempotent read.

### Query `metaSearch`
- **Purpose**: Blend keyword and vector search across entities and annotations.
- **Inputs**: `tenantId`, `projectId`, `queryText`, `embeddingVector` (optional), `topK`, `filters`.
- **Outputs**: `results` list with `entityId`, `score`, `highlight`, `source`.
- **Notes**: Returns deterministic ordering per query; optional vector provided must match supported embedding model.

### Mutation `registerEndpoint`
- **Purpose**: Register or update external endpoint for orchestration (`endpointSyncWorkflow`).
- **Inputs**: `tenantId`, `projectId`, `endpointId`, `sourceSystem`, `connectionConfig`, `specRef`, `schedule`.
- **Outputs**: `status` (`created`, `updated`), `version`, `nextRunAt`.
- **Notes**: Idempotent by `endpointId`; retries reapply latest configuration.

### Mutation `triggerSync`
- **Purpose**: Manually trigger an endpoint synchronization workflow.
- **Inputs**: `tenantId`, `projectId`, `endpointId`, `manualTriggerId`.
- **Outputs**: `workflowId`, `runId`, `status`.
- **Notes**: Idempotent on `manualTriggerId`; duplicate calls return existing run info.

### Mutation `annotate`
- **Purpose**: Add or update annotations on entities or edges.
- **Inputs**: `targetType` (`entity` or `edge`), `targetId`, `annotationKey`, `value`, `visibility`, `specRef`.
- **Outputs**: `annotationId`, `status`, `version`, `updatedAt`.
- **Notes**: Idempotent on combination of `target`, `annotationKey`, and `visibility`.

### Mutation `kvGet`
- **Purpose**: Retrieve KV checkpoint value for specified key.
- **Inputs**: `tenantId`, `projectId`, `key`.
- **Outputs**: `value`, `version`, `lastWriter`, `updatedAt`.
- **Notes**: Read-only; respects RLS. Returns `null` if no value exists.

### Mutation `kvPut`
- **Purpose**: Set KV checkpoint using CAS semantics.
- **Inputs**: `tenantId`, `projectId`, `key`, `expectedVersion`, `value`, `requestId`, `ttlSeconds`.
- **Outputs**: `status` (`stored`, `version_conflict`), `version`, `updatedAt`.
- **Notes**: Idempotent when `requestId` repeats; version conflicts must be handled by caller per KV spec.

## REST Operations

### POST `/ingress/batch`
- **Purpose**: Accept batched normalized items or edges from trusted connectors.
- **Inputs**: JSON body with `tenantId`, `projectId`, `batchId`, `items` (list with `type`, `payload`, `specRef`).
- **Outputs**: JSON response with `status` (`accepted`, `partial`, `rejected`), `ingestedCount`, `errors`.
- **Notes**: Idempotent via `batchId`; duplicates acknowledged without reprocessing. Request limited to 5 MB payloads. Returns 202 on async processing.

### PUT `/embeddings/put`
- **Purpose**: Store embeddings generated outside core services.
- **Inputs**: JSON body `tenantId`, `projectId`, `entityId`, `modelId`, `vector`, `hash`, `specRef`.
- **Outputs**: JSON response `status` (`stored`, `unchanged`), `embeddingId`, `version`.
- **Notes**: Idempotent when `hash` matches existing embedding. Requires signed authentication token.

## Pagination & Idempotency Summary
- GraphQL queries use cursor-based pagination; response includes `pageInfo` with `endCursor`, `hasNextPage`.
- Mutations that modify state (registerEndpoint, annotate, kvPut) treat request IDs or resource IDs as idempotency keys.
- REST endpoints rely on `batchId` or `hash` for idempotency and return 409 conflicts when rules are violated.

## Security & RLS Alignment
- All operations require tenant/project claims; unauthorized access returns 403.
- Audit pipeline records GraphQL mutations and REST writes with `requestId`, `specRef`, `directive`.

## Acceptance Criteria
- API returns structured errors for validation failures with field-level messages.
- Pagination tokens remain stable across library versions and expire after 24 hours.
- Idempotent requests do not create duplicates, verified via integration tests.
- SLO monitoring captures p95 latency for `metaEntities` and `/ingress/batch`.
