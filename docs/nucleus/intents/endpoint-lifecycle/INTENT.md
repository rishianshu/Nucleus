* title: Endpoint lifecycle (CRUD, collections, soft delete, E2E verification)
* slug: endpoint-lifecycle
* type: feature
* context:

  * apps/metadata-api (GraphQL resolvers, Temporal integration, Prisma models)
  * apps/designer (Metadata Workspace: Endpoints list, detail, datasets, Catalog)
  * prisma/metadata (MetadataEndpoint, MetadataRecord, MetadataCollectionRun)
* why_now: Endpoint CRUD and collection triggers exist in pieces but lack a complete, validated end-to-end flow. Missing soft-delete semantics and lack of UI-state rigor lead to issues like infinite loading, stale datasets, and unverified collection behavior.
* scope_in:

  * Create endpoint using JDBC Postgres template (provided parameters)
  * Auto-trigger initial metadata collection on registration
  * List endpoints (active only), view details, view datasets
  * Manual “Trigger Collection” and run-chip visibility
  * Edit credentials: wrong → test/trigger fail; correct → test/trigger succeed
  * Soft delete endpoint: hide from list, block triggers, hide datasets, preserve run history
  * Apply ADR-0001 UI State Contract to list/detail/datasets pages
* scope_out:

  * Hard delete or archival workflows
  * Advanced scheduling / cron
  * Connector-driver development
* acceptance:

  1. Create endpoint from given Postgres template → auto collection succeeds, datasets appear.
  2. Manual Trigger Collection creates a run and surfaces in UI.
  3. Editing endpoint with wrong password → test & trigger fail with proper errors.
  4. Restoring correct password → test & trigger succeed.
  5. Soft delete removes endpoint from list, hides datasets, blocks triggers, preserves run history.
  6. All endpoint views follow UI State Contract (loading → data/empty/error/auth).
* constraints:

  * INTENT/SPEC format compliance
  * Additive DB migration only (soft delete)
  * No secrets in logs or error payloads
  * CI (< 8 minutes)
* non_negotiables:

  * Must fail-closed on capability/auth errors
  * Soft-deleted endpoints must never appear in list or Catalog datasets
  * No infinite loading states in any endpoint view
* refs:

  * docs/meta/ADR-0001-ui-state-contract.md
  * intents/endpoint-list-authz-bug/*
* status: ready
