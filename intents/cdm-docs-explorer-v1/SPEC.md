# SPEC — CDM Docs Explorer v1

## Problem

We now ingest documentation from semantic sources (Confluence, OneDrive) into a shared CDM docs model, but the UI only exposes a minimal or non-existent Docs view. There is no:

- Unified list of documents across sources,
- Dataset/source awareness (which ingestion path produced a document),
- Simple way to inspect a document’s metadata/content before using it downstream.

We need a proper Docs explorer inside the CDM Explorer shell, analogous to the Work explorer, but tailored to documents.

## Interfaces / Contracts

### 1. CDM Docs GraphQL

We build on the existing CDM entity envelope used by the CDM Explorer.

#### 1.1. Docs entity shape

Assume CDM defines a document entity (conceptually `cdm.docs.document`) with fields such as:

- `id` (CDM document id),
- `title`,
- `docType` (page, file, spec, runbook, etc.),
- `projectKey` / `workspace`,
- `location` or `path` (e.g., space + page path, drive + folder),
- `sourceSystem` (confluence, onedrive, …),
- `sourceEndpointId`,
- `sourceDatasetId`,
- `updatedAt`,
- `contentExcerpt` (short text),
- full normalized payload as JSON.

We will expose docs via the existing `CdmEntity` envelope with `domain = DOCS`.

Extend `CdmEntity` with docs-specific fields:

```graphql
extend type CdmEntity {
  # For DOCS domain; nullable for others.
  docTitle: String
  docType: String
  docProjectKey: String
  docLocation: String
  docUpdatedAt: DateTime
  docSourceSystem: String
  docDatasetId: ID
  docDatasetName: String
}
````

These are convenience fields derived from the underlying CDM docs record to avoid deep JSON parsing in the UI.

#### 1.2. Filters

Extend `CdmEntityFilter` with docs-related filters:

```graphql
extend input CdmEntityFilter {
  docDatasetIds: [ID!]
  docSourceSystems: [String!]
  docSearch: String
}
```

Semantics:

* `docDatasetIds` filters by the originating docs dataset(s).
* `docSourceSystems` limits to certain systems (e.g., just `confluence`).
* `docSearch` is a best-effort text search (title + path + excerpt) implemented by the resolver (no strict ranking required).

All optional; omitting them preserves current behavior.

#### 1.3. Docs dataset metadata

Add a lightweight helper query:

```graphql
type CdmDocsDataset {
  id: ID!
  name: String!          # e.g. "CUS Confluence", "CUS OneDrive"
  sourceSystem: String!  # "confluence", "onedrive", ...
}

extend type Query {
  cdmDocsDatasets: [CdmDocsDataset!]!
}
```

Implementation can derive this from:

* CDM sinks and ingestion units that write docs,
* or a small registry table if one already exists.

### 2. UI — Docs tab behavior

The CDM Explorer already has a shell and tabs (Work / Docs). This slug targets the **Docs** tab.

#### 2.1. Controls

At the top of the Docs tab, add:

1. **Dataset selector**:

   * Default: `All datasets`
   * Options from `cdmDocsDatasets` (sorted, grouped by `sourceSystem` if desired).

2. **Source filter** (optional but recommended):

   * e.g. multi-select chips: `Confluence`, `OneDrive`, etc.
   * Drives `docSourceSystems` filter.

3. **Search bar**:

   * Single free-text input mapped to `docSearch`.

Changing any control:

* Updates the `CdmEntityFilter` passed to the underlying query, with `domain = DOCS`.

#### 2.2. Table columns

Docs table shows one row per CDM doc entity, with columns:

* Project/workspace (friendly label from `docProjectKey`),
* Title (`docTitle`),
* Type (`docType`),
* Source (from `docSourceSystem` / dataset name),
* Updated (`docUpdatedAt`).

Rows are sorted by `docUpdatedAt` (desc) by default.

#### 2.3. Row selection & detail panel

Clicking a row:

* Sets the selected doc,
* Does **not** refetch the entire table,
* Opens or updates a right-hand detail panel.

Detail panel includes:

* Header:

  * Title,
  * Type,
  * Project/workspace,
  * Dataset/source labels.

* Metadata section:

  * Full path/location (space + page path, drive + folder),
  * Source system and endpoint name,
  * Last updated, created, maybe owner/author if present in CDM.

* Content excerpt:

  * Rich text or markdown snippet based on CDM content excerpt / body (format as plain text is OK for v1).

* Actions:

  * “Open in source” — opens the underlying Confluence/OneDrive URL.
  * “View dataset” — link to catalog dataset detail representing this docs dataset.

* Raw CDM view:

  * Collapsible JSON section with the full CDM document payload.

### 3. Data & State

* CDM docs tables/entities already hold the normalized docs.

* GraphQL resolvers:

  * Map docs records into `CdmEntity` with `domain = DOCS` and the doc-specific convenience fields.
  * Implement `cdmDocsDatasets` query from ingestion/CDM sink metadata.

* UI state:

  * `selectedDatasetId` or “All”.
  * `selectedSourceSystems` list.
  * `searchTerm`.
  * `selectedDocId` for detail panel.

Pagination follows the existing CDM Explorer pattern (e.g., `first/after`).

## Constraints

* No breaking GraphQL changes; we only add fields/queries/filters.
* Table queries must remain paginated and reasonably efficient (indexes on `docUpdatedAt`, `datasetId`, and main search fields are desirable).
* Docs explorer should reuse the standard CDM Explorer shell components where possible.

## Acceptance Mapping

* AC1 → Docs tab shows a Docs table with the columns above populated for seeded Confluence docs.
* AC2 → Dataset/source filters and search bar drive the `CdmEntity` filter and update results.
* AC3 → Row click opens a detail panel with metadata, excerpt, and “open in source/dataset” actions.
* AC4 → `CdmEntity` exposes doc-specific fields plus `docDatasetId`/`docDatasetName` and these are used by the explorer.
* AC5 → CI (`pnpm ci-check`) remains green with new tests.

## Risks / Open Questions

* R1: Full-text search across large document volumes may require an index; for v1 we accept a simple “ILIKE” search or equivalent, scoped to the harness size.
* Q1: How large can the excerpt be without hurting performance? v1 may cap at e.g. 1–2 KB and leave full content retrieval to later slugs.
