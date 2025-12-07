# Future Requirement — Docs ACL follow-up

## Context
- Current slug (`docs-access-graph-and-rls-v1`) added ACL ingestion units (Confluence/OneDrive) and RLS plumbing, with `cdm_doc_access` persisted via CDM sink.
- Real Confluence ACL run succeeded into `cdm_work.cdm_doc_access` (28 rows) using CDM sink endpoint `fd5b783dc26b484ca597a664503271d6`.
- Outstanding gaps: ingestion run stability (Temporal ENOENT on persisted batches), metadata copy/KB edges, and UI/ops visibility for ACLs.

## Goals (next slug)
1) Make ACL ingestion durable and observable
   - Eliminate transient staging-file ENOENT errors in `persistIngestionBatches` for ACL units.
   - Ensure policy parameters (base_url/credentials) are always merged into ingestion runs; add explicit unit-level smoke tests for ACL planning/execution.
   - Add telemetry: log slices/batches for ACL units, with clear success/fail counters and last-sync time per endpoint.
2) Persist ACLs in canonical stores
   - Mirror `cdm_doc_access` from `cdm_work` into `metadata.cdm_doc_access` (or add a controlled job) so GraphQL resolvers and admin UI can rely on a single index.
   - Optional stretch: emit KB edges (`principal -> doc`) from `cdm_doc_access` via metadata-api job; keep ingestion runtime graph-agnostic.
3) Product/UI flow
   - Surface ACL ingestion state in UI (last sync, rows, errors) and show a basic access summary on Doc detail.
   - Provide an admin-facing ACL explorer table filtered by endpoint/project.
4) Coverage and tests
   - Add resolver tests that read from `metadata.cdm_doc_access` mirror.
   - Add ingestion workflow test fixture for ACL units (plan + run) validating rows land in both CDM and metadata mirrors.

## Definition of Done
- ACL ingestion runs without staging ENOENT errors; unit state shows SUCCEEDED with persisted batches.
- `metadata.cdm_doc_access` kept in sync with `cdm_work.cdm_doc_access` (either direct sink or mirror job).
- UI exposes ACL sync status and access summary; GraphQL resolvers pass updated RLS tests.
- Docs updated (ENDPOINTS/ACL section) with the new storage/flow and operator steps to trigger ACL sync.***
