# SPEC — Endpoint lifecycle (CRUD, collections, soft delete, E2E)

## Problem

Endpoint CRUD and collections work individually but not as a unified, verified lifecycle. Missing soft-delete and UI-state handling cause failures (e.g., infinite loading, stale datasets). We need a complete contract for create → auto-collect → manual-collect → bad-credential → fix → soft-delete → UI cleanup.

## Interfaces / Contracts

### GraphQL Queries

* `endpoints(projectSlug, capability, search, first, after): [MetadataEndpoint!]!`

  * Returns only endpoints where `deletedAt = null`
* `endpoint(id: ID!): MetadataEndpoint`
* `endpointDatasets(endpointId: ID!, domain, first, after): [MetadataRecord!]!`

  * Filters out datasets whose endpoints are soft-deleted

### GraphQL Mutations

* `testEndpoint(input: TestEndpointInput!): TestResult!`
* `registerEndpoint(input: EndpointInput!): MetadataEndpoint!`

  * MUST auto-trigger an initial collection run
* `updateEndpoint(id:ID!, patch:EndpointPatch!): MetadataEndpoint!`

  * If connection fields changed and last test failed → `E_CONN_TEST_REQUIRED`
* `triggerCollection(endpointId:ID!, filters, schemaOverride): MetadataCollectionRun!`

  * Soft-deleted endpoint → `E_ENDPOINT_DELETED`
  * Bad credentials → `E_CONN_INVALID` or failing run
* `deleteEndpoint(id:ID!): Boolean!`

  * SOFT DELETE (sets `deletedAt`, not removed)

### Error Model

* `E_CONN_TEST_FAILED` — invalid connection parameters
* `E_CONN_TEST_REQUIRED` — connection changed but no passing test
* `E_CONN_INVALID` — attempted trigger with known bad creds
* `E_ENDPOINT_DELETED` — operations on deleted endpoint
* `E_ENDPOINT_NOT_FOUND`
* Auth: `E_AUTH_REQUIRED`, `E_ROLE_FORBIDDEN`
* Capability: `E_CAPABILITY_MISSING`

### Temporal Workflows

* `wf.endpoint.testConnection(TestEndpointInput) → TestResult`
* `wf.collection.trigger({endpointId, filters, schemaOverride}) → {runId, status}`

  * Used for auto-collect after register & manual trigger

## Data & State

### Prisma additions

```prisma
deletedAt       DateTime?   // soft delete
lastTestOkAt    DateTime?   // track last successful test
```

### Dataset association

* Collectors MUST tag records with: `labels += ["endpoint:<endpointId>"]`
* Catalog hides datasets whose endpoint has `deletedAt != null`

## Constraints

* SPEC must fit agent schema
* No breaking GraphQL field removals
* CI < 8 min
* No secrets in logs/errors
* UI must follow ADR-0001 (loading/data/empty/error/auth)

## Acceptance Mapping

* AC1 → GraphQL + Temporal: create → auto run → catalog datasets
* AC2 → manual trigger → run visible
* AC3 → bad creds → test + trigger fail
* AC4 → fix creds → both succeed
* AC5 → soft delete → hidden from list & catalog, triggers blocked
* AC6 → e2e UI State Contract

## Risks / Open Questions

* R1: Auto-collection failures require a clean error banner
* R2: Soft-delete may need admin-view later (out of scope)
* Q1: Should `lastTestOkAt` strictly gate trigger? (current AC: fail observable)
