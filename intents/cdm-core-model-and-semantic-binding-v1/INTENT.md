
- title: CDM core work model & Jira binding v1
- slug: cdm-core-model-and-semantic-binding-v1
- type: feature
- context:
  - platform/spark-ingestion/runtime_core/cdm/*
  - platform/spark-ingestion/packages/metadata-service/src/metadata_service/cdm/*
  - runtime_common/endpoints/jira_* (Jira HTTP endpoint + ingestion units)
  - docs/meta/nucleus-architecture/*
- why_now: Nucleus needs a vendor-agnostic Common Data Model (CDM) for work management tools so that ingestion from Jira (and later other semantic sources) lands in a stable schema. Today we only think in Jira-shaped payloads, and the CDM story ignores key artifacts like comments and worklogs. Before adding CDM sinks or richer signals, we need a core CDM work model (project, user, item, comment, worklog) and a tested Jira mapping layer.
- scope_in:
  - Define CDM work models in Python for project, user, item, comment, and worklog under a central runtime_core.cdm module.
  - Add a pure Jira→CDM mapping layer that maps normalized Jira payloads (projects/issues/users/comments/worklogs) into CDM models with deterministic IDs.
  - Extend Jira ingestion unit descriptors to advertise which CDM model each unit feeds via a cdm_model_id field.
  - Add architecture docs describing the CDM work model and how Jira bindings work (metadata-first + cdm_model_id).
- scope_out:
  - Creating or wiring CDM sinks/tables; no data is written anywhere new in this slug.
  - Changing ingestion workflows or Temporal signatures.
  - Non-Jira semantic sources (Confluence/OneDrive etc.) beyond shaping the CDM to be ready for them.
- acceptance:
  1. CDM work models for project, user, item, comment, and worklog exist in a shared Python module and pass basic unit tests.
  2. Jira→CDM mapping helpers convert sample Jira project/user/issue/comment/worklog payloads into the CDM models with deterministic IDs and expected field mappings.
  3. Jira ingestion unit descriptors expose cdm_model_id for the relevant Jira datasets (projects, issues, users, comments, worklogs where units exist).
  4. Architecture docs explain the CDM work model and Jira CDM bindings (including comments/worklogs) and are referenced from endpoint/ingestion docs.
- constraints:
  - CDM must be source-agnostic; Jira-specific details live in properties bags, not in top-level field names.
  - CDM evolution must be additive (only new optional fields in future versions).
  - No ingestion/KB/DB schema changes in this slug.
- non_negotiables:
  - Comments and worklogs are first-class CDM entities in v1, not deferred “later”.
  - Mapping functions must be pure and deterministic; no I/O, no writes to sinks/KB.
- refs:
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/jira-metadata-HLD.md
  - docs/meta/nucleus-architecture/jira-metadata-LLD.md
- status: in-progress
