# SPEC — CDM Work multi‑entity & dataset‑aware explorer

## Problem

The current CDM Explorer Work tab presents Work as a single flat table of `work.item` records. In practice, Work data includes multiple entity types (issues, comments, worklogs, etc.) ingested from different datasets with different schemas. Without first‑class entity and dataset selection:

- Comments/worklogs are effectively invisible.
- The Work table shows only minimal fields (e.g., keys) while status/assignee/updated and “child” entities stay empty.
- It is hard to trace a CDM row back to its source dataset or debug ingestion per dataset.

We need the Work tab to understand multiple Work CDM entities, and to act as a semantic dataset viewer for each.

## Interfaces / Contracts

### 1. CDM Work models

Assumption: CDM Work already defines (or will define) at least:

- `cdm.work.item` — canonical issues/tickets.
- `cdm.work.comment` — comments attached to work items.
- `cdm.work.log` — worklogs / time entries.

Each CDM entity must include:

- A stable `id` and `sourceSystem` (e.g., `jira`).
- A reference to originating Work item where applicable (`parentItemId` for comments/logs).
- Source metadata:
  - `sourceEndpointId`
  - `sourceDatasetKey` or `sourceUnitId`

We do **not** change the physical schema in this slug; we ensure these fields exist and are populated in Jira mappings.

### 2. GraphQL Work APIs

We keep existing Work item queries intact and introduce typed queries for additional entity types and dataset metadata.

#### 2.1. Work entity enums

Extend or introduce:

```graphql
enum CdmWorkEntityKind {
  ITEM
  COMMENT
  LOG
  # future: TRANSITION, ATTACHMENT, ...
}
````

(This is a Work‑specific enum, separate from the top‑level `CdmDomain` used by the CDM Explorer shell.)

#### 2.2. Work entity queries

Add typed connections if not already present:

```graphql
input CdmWorkItemFilter {
  projectIds: [ID!]
  sourceSystems: [String!]
  datasetIds: [ID!]
  status: [String!]
  search: String
}

input CdmWorkCommentFilter {
  projectIds: [ID!]
  sourceSystems: [String!]
  datasetIds: [ID!]
  parentKeys: [String!]
  authors: [String!]
  search: String
}

input CdmWorkLogFilter {
  projectIds: [ID!]
  sourceSystems: [String!]
  datasetIds: [ID!]
  parentKeys: [String!]
  authors: [String!]
  startedFrom: DateTime
  startedTo: DateTime
}

type CdmWorkItem { id: ID!, key: String!, summary: String, status: String, priority: String, assignee: String, projectId: ID!, updatedAt: DateTime, sourceSystem: String!, sourceDatasetId: ID!, raw: JSON! }
type CdmWorkComment { id: ID!, parentKey: String!, author: String, createdAt: DateTime, bodyExcerpt: String, projectId: ID!, sourceSystem: String!, sourceDatasetId: ID!, raw: JSON! }
type CdmWorkLog { id: ID!, parentKey: String!, author: String, timeSpentSeconds: Int, startedAt: DateTime, updatedAt: DateTime, projectId: ID!, sourceSystem: String!, sourceDatasetId: ID!, raw: JSON! }

type CdmWorkItemEdge { cursor: String!, node: CdmWorkItem! }
type CdmWorkItemConnection { edges: [CdmWorkItemEdge!]!, pageInfo: PageInfo! }

# Similarly for comments/logs
type CdmWorkCommentEdge { cursor: String!, node: CdmWorkComment! }
type CdmWorkCommentConnection { edges: [CdmWorkCommentEdge!]!, pageInfo: PageInfo! }
type CdmWorkLogEdge { cursor: String!, node: CdmWorkLog! }
type CdmWorkLogConnection { edges: [CdmWorkLogEdge!]!, pageInfo: PageInfo! }

extend type Query {
  cdmWorkItems(filter: CdmWorkItemFilter, first: Int!, after: String): CdmWorkItemConnection!
  cdmWorkComments(filter: CdmWorkCommentFilter, first: Int!, after: String): CdmWorkCommentConnection!
  cdmWorkLogs(filter: CdmWorkLogFilter, first: Int!, after: String): CdmWorkLogConnection!
}
```

Rules:

* These APIs are **additive**; existing Work item APIs remain valid.
* `raw` exposes the normalized CDM record (not arbitrary full source payload), so UI can show a JSON tab without needing additional endpoints.

#### 2.3. Dataset metadata for filters

Introduce a small metadata query to power Work filters:

```graphql
type CdmWorkDataset {
  id: ID!
  label: String!        # e.g. "CUS Issues", "CUS Comments"
  entityKind: CdmWorkEntityKind!
  endpointId: ID!
}

extend type Query {
  cdmWorkDatasets: [CdmWorkDataset!]!
}
```

Implementation can derive this from:

* Ingestion units configured for Jira/other sources,
* CDM sink configuration.

### 3. UI Work tab behavior

#### 3.1. Entity and dataset selectors

The Work tab gains:

* `Entity` selector (radio/tab or dropdown):

  * Issues, Comments, Worklogs (mapped to `CdmWorkEntityKind`).
* `Dataset` selector:

  * “All datasets” + specific datasets from `cdmWorkDatasets` filtered by the selected entity kind.
* Existing filters remain, but some are entity‑specific (e.g., no “status” for worklogs).

#### 3.2. Per‑entity column sets

For each entity kind:

* **Issues**:

  * Project (friendly label, not raw CDM id)
  * Key
  * Summary
  * Status
  * Priority
  * Assignee
  * Updated
  * Dataset label
* **Comments**:

  * Project
  * Parent key
  * Author
  * Created
  * Body excerpt
  * Dataset label
* **Worklogs**:

  * Project
  * Parent key
  * Author
  * Time spent
  * Started
  * Updated
  * Dataset label

#### 3.3. Row selection & detail panel

Clicking a row:

* Sets selection without refetching the entire table.
* Opens a right‑hand detail panel showing:

  * All CDM fields for that entity (e.g., full summary/body, timestamps, IDs).
  * The dataset and endpoint labels.
  * Actions:

    * “Open in source” (Jira URL, if available).
    * “Open dataset” (go to catalog dataset detail).
    * “View raw CDM record” (pretty‑printed JSON from `raw`).

### 4. Error/loading behavior

* Table and detail panel should show independent loading/failure states.
* Empty states per entity kind (e.g., “No comments ingested yet” rather than a generic message).

## Data & State

* CDM Work tables/entities contain records for items, comments, worklogs with source metadata fields.
* GraphQL resolvers:

  * Map from CDM storage to the new Work entity types.
  * Construct dataset metadata for `cdmWorkDatasets` from ingestion configuration.

No new persistent tables are required in this slug; we reuse existing CDM storage and ingestion metadata.

## Constraints

* All new GraphQL types/queries are additive; removing/changing existing fields is not allowed.
* CDM Work queries must remain paginated and should support basic filters efficiently (indexes where needed).
* UI reuses the existing CDM Explorer shell structure.

## Acceptance Mapping

* AC1 → Entity selector and Work CDM models (items/comments/worklogs) wired to it.
* AC2 → Jira data populates the appropriate columns for each Work entity type.
* AC3 → Dataset selector and dataset column present, backed by `cdmWorkDatasets`.
* AC4 → Detail panel behavior with raw payload and source/dataset links.

## Risks / Open Questions

* R1: Volume of comments/worklogs may be high; pagination and filter defaults must be chosen carefully to avoid slow queries.
* Q1: How to surface very verbose comment bodies in the UI (full vs excerpt); v1 will use a short excerpt in table and full body in detail.
