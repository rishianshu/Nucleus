- title: CDM sinks & autoprovision v1
- slug: cdm-sinks-and-autoprovision-v1
- type: feature
- context:
  - runtime_core/cdm/* (CDM work models + Jira mappers)
  - platform/spark-ingestion/runtime_common/endpoints/* (sink endpoints)
  - platform/spark-ingestion/temporal/ingestion_worker.py
  - apps/metadata-api (GraphQL + Prisma models for ingestion + metadata)
  - docs/meta/nucleus-architecture/*
- why_now: CDM work models and Jira→CDM mappings are in place, and ingestion units can now run in {raw|cdm} mode. However, there is no concrete CDM sink endpoint that persists CDM rows or a mechanism to auto-create CDM tables and register them as datasets. To make CDM useful beyond theory, we need an internal CDM-aware sink and a minimal autoprovision flow that creates physical tables and publishes their metadata to the catalog.
- scope_in:
  - Introduce at least one internal CDM sink endpoint (e.g., Postgres-based) that can persist CDM work entities (item, project, user, comment, worklog).
  - Add sink capabilities to express which CDM models the sink supports (e.g., `sink.cdm.work`, `supported_cdm_models`).
  - Implement an autoprovision operation that:
    - given a sink endpoint + CDM model id, creates the corresponding table(s) if they do not exist, and
    - registers/updates the associated dataset metadata in the catalog.
  - Wire autoprovision into the ingestion flow so that CDM-mode ingestion can target a CDM sink that has been provisioned, and the resulting CDM datasets become visible to the metadata catalog.
- scope_out:
  - Rich CDM data explorer UI (separate slug).
  - Non-work CDM domains (docs/people/etc.).
  - Any CDM-aware analytics layer; this slug only creates storage + catalog registration.
- acceptance:
  1. A CDM sink endpoint template exists and exposes capabilities for supported CDM work models.
  2. Autoprovision creates physical tables for at least `cdm.work.item` (and ideally related work entities) and is idempotent.
  3. Autoprovision registers CDM datasets into the metadata catalog so they appear alongside other datasets.
  4. CDM-mode ingestion can successfully write CDM-shaped records into the CDM sink without breaking existing raw ingestion flows.
- constraints:
  - No breaking changes to existing sink endpoints or ingestion workflows.
  - CDM sink should prefer Postgres (or existing relational infra) to avoid bringing in new infra for v1.
  - Autoprovision must be safe to re-run (idempotent DDL + metadata upsert).
- non_negotiables:
  - CDM sink behavior must respect the Source → Staging → (optional CDM) → Sink design; sinks do not perform mapping.
  - CDM datasets registered in metadata must clearly identify their CDM model id and origin sink.
- refs:
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-ingestion-modes-and-sinks-v1/*
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/CDM-WORK-MODEL.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
- status: in-progress
