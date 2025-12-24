# SPEC — Materialized artifacts registry + index trigger (tenant-scoped, canonical metadata)

## Problem

Indexing cannot scale when large ingestion outputs are passed through Temporal workflow messages. We also need canonical metadata keys to support consistent filtering and future citations. This spec defines a "materialize → registry → index" contract that is source/sink-agnostic and tenant-scoped via auth context.

## Interfaces / Contracts

### 1) Materialized Artifact Registry (conceptual contract)

A **MaterializedArtifact** is a durable record that says: "a sink write completed; here is how to locate the output."

**Record fields (minimum):**

* `id: string` (opaque UUID)
* `tenantId: string` *(derived; never user-supplied)*
* `sourceRunId: string` (ingestion run/workflow run)
* `artifactKind: string` (e.g., `code.bundle`, `doc.batch`, `work.batch`)
* `sourceFamily: string` (e.g., `github`, `jira`, `confluence`, `jdbc`)
* `sinkEndpointId: string | null` (if applicable)
* `handle: Json` (opaque locator/handle; e.g., MinIO bucket+prefix; staging handle; etc.)
* `canonicalMeta: Json` (canonical keys for search/citations)
* `sourceMeta: Json` (source-specific keys; nested under a namespaced object)
* `status: enum` = `READY | INDEXING | INDEXED | FAILED`
* `createdAt, updatedAt`

**Canonical metadata keys (required in `canonicalMeta`):**

* `projectKey: string`

  * Confluence `spaceKey` → `projectKey`
  * GitHub `repoKey` → `projectKey`
  * Jira `projectKey` → `projectKey`
* `sourceKind: "doc" | "work" | "code" | "schema" | "unknown"`
* `sourceId: string` (stable within source family; e.g., repo full name, docId, issue key)
* `sourceUrl: string | null` (deep link if available)
* `title: string | null` (display label)
* `updatedAt: string | null` (ISO timestamp when known)

**Source-specific metadata (`sourceMeta`)**

* A nested object keyed by source family, e.g.:

  * `sourceMeta.github = { repoKey, owner, repo, ref, pathPrefix }`
  * `sourceMeta.confluence = { spaceKey, spaceId, baseUrl }`
  * `sourceMeta.jira = { projectKey, cloudId, siteUrl, jql }`

### 2) Completion → Registry upsert → Index trigger

On sink completion (end of ingestion run or end of sink activity):

1. Produce a `MaterializedArtifactUpsertInput` (in-process object; not a public API).
2. `upsertMaterializedArtifact(input)`:

   * Derive `tenantId` from run context/auth (never accept as argument).
   * Deduplicate by `(tenantId, sourceRunId, artifactKind)` (idempotent).
   * Set status `READY` and store `handle + metadata`.
3. Trigger indexing using **only** `materializedArtifactId`:

   * `startIndexingWorkflow({ materializedArtifactId })`

### 3) Registry read API (admin/internal)

Expose a read-only API for debugging/ops (GraphQL or internal service):

* `materializedArtifacts(filter?: { projectKey?: string; sourceFamily?: string; status?: string }, first?: number, after?: string)`
* **No tenant argument.** Tenant is derived implicitly.

### 4) Error model

* If registry upsert fails: ingestion completion should fail closed (workflow marks run FAILED with error).
* If indexing fails:

  * registry status set to `FAILED`
  * error stored in registry record (e.g., `lastError`)
  * rerun allowed by re-triggering index on the same `materializedArtifactId` (idempotent indexer must upsert vectors)

## Data & State

### Idempotency and retries

* Registry upsert must be safe to retry (Temporal activity retries, manual retrigger).
* Indexer must be safe to retry:

  * Upsert vectors by deterministic IDs (derived from `materializedArtifactId + docId + chunkId` or equivalent).

### "No payload in workflow" invariant

* Temporal inputs may include:

  * `materializedArtifactId`
  * small scalar filters/config
* Temporal inputs must not include:

  * raw ingested rows
  * document text bodies
  * large JSON batches

## Constraints

* Tenant scoping: derive tenant from auth token / run context; never accept tenantId as API argument.
* Performance: registry upsert per completion < 250ms server-side; index trigger enqueue < 250ms.
* Compatibility: existing ingestion flows remain valid; new registry writes can be adopted incrementally.

## Acceptance Mapping

* AC1 → integration test: run completion writes one registry record; rerun completion is idempotent.
* AC2 → integration/e2e: indexing workflow starts with only registryId; indexer reads via handle and writes vector entries.
* AC3 → unit/integration: canonical metadata keys are present and consistent; sourceMeta preserved.
* AC4 → integration: registry list API returns only current tenant's records; no tenant parameter exists.

## Risks / Open Questions

* R1: Multiple artifact kinds per run (e.g., code + docs) may require multiple registry entries; for v1 we key idempotency by `(tenantId, sourceRunId, artifactKind)`.
* R2: Some sources may not have stable `sourceUrl`; allow null and rely on IDs.
* Q1: Exact handle schema per sink (MinIO vs future sinks) must remain opaque to the registry; only indexer profile interprets it.
