- title: CDM Work multi‑entity & dataset‑aware explorer
- slug: cdm-work-multi-entity-v1
- type: feature
- context:
  - apps/metadata-ui (CDM Explorer shell, Work tab)
  - apps/metadata-api (CDM work GraphQL resolvers/schema)
  - runtime_core/cdm/work/* (work CDM models)
  - runtime_common/endpoints/* (Jira catalog + CDM bindings)
  - docs/meta/nucleus-architecture/*
- why_now: The CDM Explorer Work tab only surfaces a single `work.item` shape with minimal columns. Real “Work” data includes multiple entity types (issues, comments, worklogs, etc.) coming from separate datasets with different schemas. Without first‑class entity/dataset selection and detail views, the explorer hides most of the ingested signal and makes it hard to debug or use CDM outputs.
- scope_in:
  - Model multiple CDM Work entity types explicitly (at least items, comments, worklogs).
  - Extend the Work tab in CDM Explorer to let users choose entity type and dataset.
  - Provide per‑entity column sets and detail panels, including a view of the raw CDM record and links back to source dataset/endpoint.
  - Ensure Jira→CDM mappings populate core fields for each entity type so the tables aren’t mostly empty.
- scope_out:
  - New sources (e.g., GitHub, Linear) beyond existing Jira bindings.
  - Advanced analytics (charts, aggregations) over CDM Work.
  - Changes to ingestion planning/probing beyond what’s needed to expose existing CDM records.
- acceptance:
  1. Work tab supports multiple Work entity types (items, comments, worklogs) with an explicit selector.
  2. Each Work entity type has its own column set and shows populated fields for Jira data (no more “all dashes” tables).
  3. Users can filter Work views by dataset/ingestion unit and see which dataset a row belongs to.
  4. Clicking a Work row opens a detail panel with full CDM fields, raw payload, and links back to the source system and catalog dataset, without refetching the entire table.
- constraints:
  - GraphQL changes must be additive and backward compatible (existing Work item queries keep working).
  - Explorer queries must remain paginated and efficient; no unbounded loads.
  - Keep UX consistent with the current CDM Explorer shell (no new top‑level nav entries).
- non_negotiables:
  - “Work” must be treated as a family of entity types, not a single flat table.
  - CDM Explorer must remain a semantic/CDM view; raw source tables stay in Catalog.
- refs:
  - intents/cdm-explorer-shell-v1/*
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-work-explorer-v1/*
  - intents/semantic-jira-source-v1/*
  - docs/meta/nucleus-architecture/CDM-WORK-MODEL.md
- status: in-progress