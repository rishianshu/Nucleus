- title: CDM Explorer shell v1
- slug: cdm-explorer-shell-v1
- type: feature
- context:
  - apps/metadata-ui (CDM work explorer, catalog views, nav shell)
  - apps/metadata-api (CDM work resolvers, GraphQL schema)
  - runtime_core/cdm/* (work + docs CDM models)
  - docs/meta/nucleus-architecture/*
- why_now: CDM work explorer exists as a one-off UI backed by work CDM and Jira ingestion. Docs CDM is defined and Confluence ingestion is wired, but there is no UI for docs CDM and no shared “semantic explorer” shell. As we add more semantic sources (Confluence, OneDrive, GitHub, etc.), we need a unified CDM Explorer that can host multiple domains (work, docs, future code/people) without duplicating list/detail logic for each.
- scope_in:
  - Introduce a generic “CDM Explorer” shell in the UI with tabs for:
    - Work (backed by `cdm.work.*`),
    - Docs (backed by `cdm.doc.*`).
  - Refactor the existing Work CDM explorer into a plugin inside this shell (no functional regression).
  - Add a basic Docs view plugin that lists ingested doc items (e.g. Confluence pages) with filters and a detail panel.
  - Add or adapt backend GraphQL queries to support a generic CDM explorer pattern (domain + filters + paging) without breaking existing work CDM queries.
- scope_out:
  - Full-featured docs UX (rich content preview, threaded comments).
  - KB graph visualizations or signal overlays inside the explorer.
  - GitHub integration itself (future semantic source slug).
- acceptance:
  1. A single “CDM Explorer” entry exists in the UI nav with at least Work and Docs views.
  2. Work tab preserves the existing work explorer behavior with no regression (filters, list, detail).
  3. Docs tab shows CDM docs items (e.g. Confluence pages) and supports basic filtering and detail view.
  4. GraphQL exposes a generic CDM entity query pattern that can be reused for future domains (e.g. GitHub) while remaining backward compatible.
- constraints:
  - Maintain backward compatibility with existing work CDM GraphQL types and queries.
  - Keep explorer data loading efficient (paged, no “load everything”).
  - No breaking changes to ingestion or CDM sink schemas.
- non_negotiables:
  - The explorer shell must treat sources (Jira, Confluence, OneDrive, GitHub) as implementations of CDM domains, not as separate first-class UIs.
  - Work and Docs must share as much list/filter/pagination UX as practical to avoid divergence.
- refs:
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-work-explorer-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
  - intents/semantic-confluence-source-v1/*
  - docs/meta/nucleus-architecture/CDM-WORK-MODEL.md
  - docs/meta/nucleus-architecture/CDM-DOCS-MODEL.md
- status: in-progress