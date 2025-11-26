
- title: Metadata worker capabilities and HTTP preview v1
- slug: metadata-worker-capabilities-and-preview-v1
- type: techdebt
- context:
  - platform/spark-ingestion/temporal/metadata_worker.py
  - platform/spark-ingestion/runtime_common/endpoints/*
  - platform/spark-ingestion/runtime_common/metadata_subsystems/*
  - metadata_service (MetadataCollectionService, MetadataJob, cache)
  - docs/meta/nucleus-architecture/* (endpoint & ingestion docs)
- why_now: metadata_worker still hard-codes Jira HTTP vs JDBC branches and imports Jira-specific dataset definitions. Preview is JDBC-only. This breaks the endpoint/capability-centric design and makes it harder to add semantic HTTP endpoints (Jira, Confluence, CDM) while keeping the ingestion/collection story coherent. We want the worker to be a thin orchestrator that delegates behavior to endpoints and metadata subsystems based on capabilities.
- scope_in:
  - Refactor metadata_worker so metadata collection is driven by a planner abstraction that consults endpoint/template capabilities instead of branching on template ids.
  - Move Jira-specific metadata planning (datasets, jobs) into the Jira metadata subsystem / endpoint, removing Jira-specific logic from metadata_worker.
  - Extend preview to support HTTP/semantic endpoints (starting with Jira) when the endpoint advertises `metadata.preview`, keeping JDBC preview as a fallback.
  - Keep ingestion behavior unchanged except for docstrings/comments clarifying that bulk transforms (e.g., CDM) stay in the Python data-plane.
- scope_out:
  - Defining CDM models or mappings (handled by cdm-core-model-and-semantic-binding-v1).
  - Changing Temporal/TS workflow signatures or GraphQL contracts.
  - Adding new sinks or CDM endpoints.
- acceptance:
  1. metadata_worker no longer contains Jira-specific planning logic or template-id branching; it calls a generic metadata planner instead.
  2. Jira metadata collection still produces the same catalog datasets as before (same IDs and core fields).
  3. previewDataset works for Jira datasets via HTTP when supported, retains current behavior for JDBC datasets, and clearly errors for datasets without preview capability.
  4. Code and docs explicitly state that bulk data stays in the Python ingestion runtime (Source → Staging → Sink), and Temporal/TS only passes config and small semantic summaries.
- constraints:
  - No breaking changes to Temporal activity signatures (`collectCatalogSnapshots`, `previewDataset`, `runIngestionUnit`).
  - No breaking changes to catalog record shapes (CatalogRecordOutput).
  - Keep `make ci-check` and ingestion/metadata tests within current runtime budgets.
- non_negotiables:
  - Endpoint-specific metadata/preview logic must live in endpoints/subsystems, not in metadata_worker.
  - Jira remains fully metadata-driven and aligned with jira-metadata-HLD/LLD (no hidden side paths).
- refs:
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
  - docs/meta/nucleus-architecture/jira-metadata-HLD.md
  - docs/meta/nucleus-architecture/jira-metadata-LLD.md
- status: in-progress