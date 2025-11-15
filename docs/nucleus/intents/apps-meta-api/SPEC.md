# Spec: Meta API Application

## Context & Goal
- Define behaviour for the meta API application that exposes GraphQL and limited REST endpoints.
- Ensure authentication, authorization, RLS enforcement, pagination, rate limits, and signed URL flows align with platform policies.
- Provide guardrails for idempotency and payload handling, especially around blob ingestion.

## Authentication & Authorization
- Authentication via Keycloak-issued JWTs using service/client roles (see security spec).
- API validates token signature, expiration, `tenant_id`, `project_id`, `roles`, and optional `credential_ref`.
- Authorization enforced by roles:
  - `reader`: read-only access to GraphQL queries and GET-style operations.
  - `writer`: can invoke mutations, REST batch ingestion, and signed URL requests.
  - `admin`: manage endpoint registration, schedule controls, and configuration.
- Reject requests missing tenant/project claims or with invalid role scopes; return 403 with audit log.

## RLS Enforcement Points
- All database queries executed through stored procedures or ORM layers that enforce tenant/project filters automatically.
- GraphQL resolvers inject tenant/project context before hitting data layer.
- REST handlers (`/ingress/batch`, `/embeddings/put`) run RLS check prior to persistence.
- Access to MinIO or KV requires verifying claims and mapping to tenant-specific prefixes.

## GraphQL Subgraph Boundary
- Meta API hosts the core subgraph of the federated schema, exposing entities, edges, annotations, search, and KV operations.
- Only fields defined in `api-surface.md` live in this subgraph; domain-specific extensions reside in their subgraphs.
- Subgraph resolvers must not make cross-tenant calls; they rely on upstream context for identity propagation.
- Schema changes require spec update and contract validation; no dynamic field injection.

## REST Bulk Ingress Constraints
- `/ingress/batch` accepts batches up to 5 MB; larger payloads rejected with 413 and guidance to split.
- Incoming items must reference normalized contract names; unrecognized types rejected.
- Batch IDs serve as idempotency keys; duplicates return 200 with `status=accepted` and no reprocessing.
- Explicit rule: reject requests where raw blobs are embedded inline; instruct client to upload to MinIO via signed URL first.

## Signed URL Flow
- Clients request signed URLs via GraphQL mutation `generateSignedUrl` (future extension) or REST helper.
- Meta API validates requester role (`writer` or higher) and verifies tenant/project ownership.
- Signed URL expiry defaults to 5 minutes, maximum 15 minutes.
- API logs issuance event with `requestId`, `tenant_id`, `project_id`, `purpose`, `expiration`.
- Meta API never handles raw blob payloads directly; it only generates URLs and metadata records.

## Rate Limits
- Per tenant: 200 GraphQL requests per second burst, sustained 50 rps; REST batch limited to 10 per minute.
- Per service account: configurable limits stored in Keycloak client metadata.
- Rate limit breaches return 429 and log WARN with rate limiter details.
- Rate limit counters reset per minute; metrics emitted for dashboards.

## Pagination Rules
- GraphQL queries use cursor-based pagination (`after`, `limit`), returning `pageInfo`.
- Meta API enforces maximum page size of 200; larger requests trimmed and warning emitted.
- REST endpoints return pagination via `nextCursor` when streaming ingestion results becomes necessary (future).
- Pagination tokens encode tenant, project, resource ID, and version to avoid leakage.

## Idempotency Expectations
- Mutations rely on identifiable keys (entity ID, endpoint ID, annotation key) to detect duplicates.
- REST batch ingestion checks `batchId`; repeated payloads yield `status=accepted` without duplicating items.
- Signed URL requests use `requestId` to avoid redundant issuance when clients retry.
- Errors provide deterministic codes so clients can safely retry when allowed.

## Observability Hooks
- Logs follow taxonomy with fields `agent=meta-api`, `directive=<operation>`.
- Metrics track requests, latency, success/failure rates; integrate with observability spec.
- Failed authorization attempts emit `WARN` logs and increment `security_denied_total`.

## Acceptance Criteria
- All endpoints enforce Keycloak authentication and map claims to tenant/project context.
- RLS prevents cross-tenant data access verified in integration tests.
- REST bulk ingestion rejects inline blobs and logs the violation.
- Signed URL flow limited to 15 minutes expiry; issuance logged and traceable.
- Rate limiting works per tenant and per service account with metrics.
- Pagination tokens stable and secure against tampering.

## Open Questions
- Should we expose GraphQL mutations for generating signed URLs or keep REST-only?
- Do we implement adaptive rate limits based on tenancy size?
- How to allow read-only public datasets without breaking RLS rules?
