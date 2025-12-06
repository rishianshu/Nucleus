- title: Semantic OneDrive source v1
- slug: semantic-onedrive-source-v1
- type: feature
- context:
  - platform/spark-ingestion (Python endpoints, planners, staging)
  - platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*
  - apps/metadata-api/src/schema.ts (GraphQL endpoints + ingestion)
  - apps/metadata-api/src/ingestion/*
  - apps/metadata-api/src/temporal/*
  - apps/metadata-ui (Endpoints / Collections / CDM Explorer UI)
  - runtime_core/cdm/docs/* (CDM docs model + mappers)
  - docs/meta/nucleus-architecture/*
- why_now: Jira (work) and Confluence (docs) are now wired end-to-end through metadata, ingestion, CDM, and CDM Explorer. To complete the initial semantic sources trio and validate the unified ingestion + CDM + staging design on another family, we need a first-class OneDrive source that can register endpoints, catalog docs, ingest into the docs CDM, and surface results in the CDM Explorer Docs tab.
- scope_in:
  - Add a OneDrive endpoint template/descriptor to the Python endpoint registry and expose it via the CLI and metadata UI.
  - Implement a OneDrive metadata subsystem that can enumerate drives/folders/files and emit catalog datasets for docs under a configurable root.
  - Implement a OneDrive ingestion strategy using the unified ingestion planning interface (units → slices), with Source → Staging → Sink flow and docs CDM mapping.
  - Integrate OneDrive docs into the CDM docs explorer (Docs tab) alongside Confluence, with dataset/source labels.
  - Provide a basic dev harness and tests (Python + TS) for OneDrive metadata and ingestion behavior.
- scope_out:
  - Fine-grained ACL / permission modeling for per-folder or per-file access control in the UI.
  - Advanced OneDrive-specific filters (e.g., by label, retention policy) beyond simple path/type filters.
  - Vector indexing / semantic retrieval for OneDrive docs (will be handled by later slugs).
- acceptance:
  1. OneDrive endpoint template exists and can be registered/tested via CLI and UI.
  2. OneDrive metadata collection emits catalog datasets for docs under a configured root (drive/folder).
  3. OneDrive ingestion units use the unified planner + staging pipeline and land docs into the CDM docs sink.
  4. CDM Docs Explorer can list OneDrive docs with correct dataset/source labels and open their detail view.
  5. Ingestion is metadata-driven: no OneDrive ingestion without corresponding catalog datasets and enabled ingestion config.
  6. CI (`pnpm ci-check`) and targeted ingestion tests pass.
- constraints:
  - Use the existing adaptive planning / staging abstractions; no one-off ingestion path for OneDrive.
  - GraphQL changes must be additive and backward compatible.
  - Keep OneDrive secrets in existing config mechanisms (.env / endpoint config); no new ad-hoc secret stores.
- non_negotiables:
  - OneDrive-specific logic (REST calls, pagination, planning) lives in the Python endpoint/strategy, not in TS/Temporal.
  - Docs land in the CDM docs sink, not in KB; KB remains semantic metadata only.
- refs:
  - intents/semantic-sources-trio-story-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
  - intents/semantic-confluence-source-v1/*
  - intents/ingestion-core-v1/*
  - intents/ingestion-source-staging-sink-v1/*
  - intents/ingestion-strategy-unification-v1/*
  - intents/cdm-docs-explorer-v1/*
- status: in-progress