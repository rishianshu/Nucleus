- title: CDM source provenance v1
- slug: cdm-source-provenance-v1
- type: feature
- context:
  - CDM work/docs models (Postgres tables + TS row types)
  - CDM ingestion mappers for Jira, Confluence, OneDrive
  - docs/meta/nucleus-architecture/CDM-*.md (work/docs/docs-CDM specs, if present)
  - UCL-based ingestion flow (Go) and CDM sinks
  - Signals + Brain/Workspace relying on CDM as the "semantic fact" layer
- why_now: CDM models currently expose semantic fields (status, project, space, etc.) and some source identifiers (e.g. Jira issue key, Confluence page id), but there is no consistent way to get back to the original record: raw source payload, canonical source id, and deep-link URL. Agents and downstream apps (Workspace, Brain API, signals) would benefit from a simple, uniform provenance footprint on CDM rows before we invest in a full lineage graph. We want a minimal, scalable way to add source provenance fields to CDM Work/Docs and wire ingestion to populate them.
- scope_in:
  - Extend CDM work/docs tables and TS models with:
    - a raw JSON blob field (where reasonable) for the source payload or metadata,
    - a canonical source identifier field (e.g. Jira issue id, Confluence content id, OneDrive driveItem id),
    - a source URL/deep link field suitable for "open in source" actions,
    - an optional source system or endpoint reference field if not already present.
  - Update CDM ingestion mappers for Jira, Confluence, and OneDrive to populate these new fields from UCL responses.
  - Update CDM explorers / GraphQL resolvers to expose provenance fields where appropriate (including source URL for "open in source").
  - Document the provenance contract so future CDM models (datasets, users, projects) can follow the same pattern.
- scope_out:
  - Full lineage/graph modeling (multi-hop source→raw→CDM→signals relationships).
  - Vector indexing or semantic search over raw blobs.
  - Any changes to UCL Go interfaces beyond what's needed to pass through provenance data into CDM mappers.
- acceptance:
  1. CDM Work and CDM Docs schemas include raw/sourceId/sourceUrl provenance fields with migrations in place.
  2. Jira, Confluence, and OneDrive CDM ingestion mappers populate these fields from source/UCL payloads.
  3. CDM GraphQL/API surfaces provenance fields (at least sourceUrl, and raw/sourceId in debug views) for work and docs.
  4. Docs describe the provenance fields, their semantics, and how new CDM models should adopt them.
  5. `pnpm ci-check` remains green with all new migrations, code, and tests.
- constraints:
  - Raw JSON blobs must remain bounded in size; large binary/doc content should stay in object storage, not CDM tables.
  - No breaking changes to existing CDM fields or GraphQL queries; new fields must be additive.
  - Provenance fields must be optional and nullable to allow backfill and partial support per connector.
- non_negotiables:
  - For each supported connector (Jira, Confluence, OneDrive), every newly ingested CDM row must carry a stable source identifier that can be used to re-fetch or link back to the source.
  - Source URLs/deep links must be constructed in a way that is stable enough for UI "open in source" buttons.
  - Provenance fields must not be overloaded with mixed semantics (raw must be raw-ish source data, not arbitrary internal state).
- refs:
  - intents/semantic-jira-source-v1/*
  - intents/semantic-confluence-source-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/CDM-*.md (if present)
- status: in-progress
