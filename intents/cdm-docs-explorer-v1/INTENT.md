- title: CDM Docs Explorer v1
- slug: cdm-docs-explorer-v1
- type: feature
- context:
  - apps/metadata-ui (CDM Explorer shell, Docs tab)
  - apps/metadata-api (CDM docs GraphQL schema/resolvers)
  - runtime_core/cdm/docs/* (CDM docs model)
  - runtime_common/endpoints/* (Confluence / OneDrive bindings)
  - ingestion metadata (units, CDM sinks for docs)
- why_now: The CDM Explorer currently has a minimal Docs view and does not treat documentation as a first-class, dataset-aware domain. With Jira and Confluence semantic sources wired into CDM, we need a proper Docs explorer to browse ingested documents (Confluence pages, OneDrive files, etc.), filter by dataset/source, and inspect document details before we can build richer downstream experiences.
- scope_in:
  - Implement a proper Docs tab inside the CDM Explorer using the existing shell/domain plugin pattern.
  - Surface docs as CDM entities with dataset/source metadata (e.g., “CUS Confluence”, “CUS OneDrive”).
  - Provide useful table columns (title, location, type, updated, source) and search/filter capabilities.
  - Add a document detail panel, including metadata and a preview/excerpt plus “open in source”.
- scope_out:
  - Vector search / semantic retrieval UI (that will come later).
  - Full content rendering (we can show HTML/markdown excerpts, but no full WYSIWYG editor).
  - New ingestion drivers or mappings beyond the existing Confluence/OneDrive CDM bindings.
- acceptance:
  1. Docs tab lists CDM docs with meaningful columns (title, project/workspace, type, updated, source).
  2. Docs tab can filter by dataset/source and text search.
  3. Clicking a row opens a document detail panel with metadata and a content excerpt plus “open in source”.
  4. Docs CDM entities expose dataset/source identity in GraphQL, and the explorer uses that to populate filters/columns.
- constraints:
  - GraphQL changes must be additive; no breaking the existing CDM APIs.
  - Data loading must remain paginated; no unbounded doc lists.
  - Keep UX consistent with the Work tab and the overall CDM Explorer shell.
- non_negotiables:
  - Docs explorer must be CDM-first (no direct coupling to Confluence/OneDrive APIs in the UI).
  - Every row must be traceable back to its source dataset and endpoint.
- refs:
  - intents/cdm-explorer-shell-v1/*
  - intents/cdm-core-model-and-semantic-binding-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
  - intents/semantic-confluence-source-v1/*
  - docs/meta/nucleus-architecture/CDM-DOCS-MODEL.md
- status: in-progress