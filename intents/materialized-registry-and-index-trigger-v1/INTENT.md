---
title: Materialized artifacts registry + index trigger (tenant-scoped, canonical metadata)
slug: materialized-registry-and-index-trigger-v1
type: feature
context: metadata-api (GraphQL + Temporal orchestration), vector-index runner, UCL ingestion completion callbacks, materialized_artifacts registry, auth scoping (tenant from token)
why_now: Current indexing is blocked by scale limits (Temporal payload size) and inconsistent metadata keys. We need a stable "materialize → registry → index" contract to unblock Brain Search + citations and stop connector-specific ad-hoc wiring.
scope_in:
  - Define/standardize the `materialized_artifacts` registry contract as the canonical output ledger for completed sink writes.
  - On ingestion completion, upsert a `materialized_artifacts` record (idempotent) with a handle to staged/sinked data (not the data itself).
  - Auto-trigger an indexing workflow/job using only the registry ID/handle (no large payload in Temporal inputs).
  - Enforce canonical, source-independent metadata keys at the registry boundary (e.g., projectKey) while retaining source-specific keys under a namespaced field.
  - Ensure tenant scoping is implicit (derived from auth token / run context) and never passed as an API argument.
  - Add tests proving: registry upsert, idempotency, and index trigger behavior.
scope_out:
  - Sink autodiscovery/autoprovisioning into catalog datasets (separate slug).
  - Full Brain Search/GraphRAG APIs and UI (separate slugs).
  - OneDrive connector enablement (parked).
acceptance:
  - Ingestion completion produces exactly one materialized_artifacts record per (tenant, run, artifactKind) and is idempotent.
  - Indexing runs are triggered via registry handle (no large payload in Temporal) and produce vector entries for the artifact.
  - Registry metadata uses canonical keys (projectKey, sourceKind, sourceId, sourceUrl) consistently across sources, with source-specific keys preserved separately.
  - Registry read APIs are tenant-scoped implicitly (no tenant parameter) and never leak cross-tenant artifacts.
constraints:
  - Must avoid passing raw/staged data through Temporal workflow inputs (use handles only).
  - Idempotent writes: safe to retry ingestion completion and indexing triggers.
  - Backward compatible: do not break existing ingestion runs; add fields/flows in a way existing connectors can adopt incrementally.
  - Performance: registry upsert must be O(1) per completion; indexing trigger must enqueue fast (<250ms server-side).
non_negotiables:
  - Tenant must be derived from auth token / run context; tenant must not be accepted as an API input for registry read/write.
  - Canonical metadata keys must be present for every registry record.
  - No connector-specific special-casing inside the registry writer.
refs:
  - sync/STATE.md (current focus mentions wiring sink completion into materialized_artifacts to auto-trigger index runs)
  - docs/meta/* (schemas/governance)
status: ready
---
