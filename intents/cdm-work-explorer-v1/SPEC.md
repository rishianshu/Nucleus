# SPEC — CDM work explorer v1

## Problem

CDM work ingestion is now end-to-end:

- Jira entities are mapped to CDM work models.
- Ingestion units can run in CDM mode.
- CDM rows are written into a Postgres-backed CDM sink and tables are provisioned.

But:

- There is no GraphQL API to read CDM work data.
- There is no UI to see CDM projects/items/comments/worklogs.
- Validation/debugging of CDM mapping requires direct DB access.

We want a minimal, read-only CDM work explorer so Nucleus users can:

- see which projects/items have been ingested into CDM,
- inspect a single work item with its comments and worklogs,
- validate that CDM mapping and ingestion are behaving as expected.

## Interfaces / Contracts

### 1. GraphQL schema (read-only CDM work API)

Add a CDM work namespace to the GraphQL schema, conceptually:

```graphql
type CdmWorkProject {
  cdmId: ID!
  sourceSystem: String!
  sourceProjectKey: String!
  name: String!
  description: String
}

type CdmWorkUser {
  cdmId: ID!
  displayName: String!
  email: String
}

type CdmWorkItem {
  cdmId: ID!
  sourceSystem: String!
  sourceIssueKey: String!
  projectCdmId: ID!
  summary: String!
  status: String
  priority: String
  assignee: CdmWorkUser
  reporter: CdmWorkUser
  createdAt: String
  updatedAt: String
  closedAt: String
}

type CdmWorkComment {
  cdmId: ID!
  author: CdmWorkUser
  body: String!
  createdAt: String
}

type CdmWorkLog {
  cdmId: ID!
  author: CdmWorkUser
  startedAt: String
  timeSpentSeconds: Int
  comment: String
}

type CdmWorkItemDetail {
  item: CdmWorkItem!
  comments: [CdmWorkComment!]!
  worklogs: [CdmWorkLog!]!
}

input CdmWorkItemFilter {
  projectCdmId: ID
  statusIn: [String!]
  search: String
}

type CdmWorkItemEdge {
  cursor: String!
  node: CdmWorkItem!
}

type CdmWorkItemConnection {
  edges: [CdmWorkItemEdge!]!
  pageInfo: PageInfo!
}

extend type Query {
  cdmWorkProjects: [CdmWorkProject!]!
  cdmWorkItems(filter: CdmWorkItemFilter, first: Int = 25, after: String): CdmWorkItemConnection!
  cdmWorkItem(cdmId: ID!): CdmWorkItemDetail
}
````

Implementation details:

* Resolvers read from CDM work tables created by `cdm-sinks-and-autoprovision-v1` (via Prisma or a dedicated Postgres client).
* Pagination can be cursor- or offset-based; keep it consistent with existing GraphQL conventions.
* Filters:

  * `projectCdmId`: filter by project.
  * `statusIn`: filter by status list.
  * `search`: full-text or simple `ILIKE` on summary; exact mechanics can be simple v1.

### 2. UI: CDM → Work explorer

Add a new section in the metadata UI navigation:

* Top-level: `CDM`
* Sub-entry: `Work`

The `CDM / Work` page has at least:

1. **Project list / filter bar**

   * A dropdown or multiselect populated from `cdmWorkProjects`.
   * Optional text search box for work item summary.
   * Status filter (multi-select with values drawn from CDM work items).

2. **Work items list**

   * Paginated table or list of `CdmWorkItem` entries, showing:

     * Project (name or key),
     * Summary,
     * Status,
     * Priority,
     * Assignee (display name),
     * Created date.
   * Row click navigates to work item detail route, e.g., `/cdm/work/items/:cdmId`.

3. **Work item detail view**

   * Separate page for a single item with layout, e.g.:

     * Header: summary, key, status, priority, project, assignee, created/updated/closed.
     * Tabs or sections:

       * **Comments**: list of `CdmWorkComment` ordered by `createdAt`.
       * **Worklogs**: list of `CdmWorkLog` ordered by `startedAt`.

   * Handles empty lists gracefully (e.g. “No comments yet”).

UX/event handling:

* Apply existing loading/empty/error patterns:

  * local spinners on list/detail,
  * clear empty states (“No CDM work items yet. Run CDM ingestion or adjust filters.”).
* No mutations: links only; no edit buttons.

### 3. Auth and roles

* Reuse the same Keycloak roles/guards used for metadata/ingestion consoles (e.g., viewer/admin).
* CDM work explorer should be behind the same auth constraints as other metadata tools:

  * unauthorized users see login,
  * users without access see a friendly “You do not have access to CDM work explorer” message.

### 4. Testability

* Provide a deterministic way to seed CDM tables for tests:

  * Either via existing Jira stub + ingestion run, or via a test helper that inserts a small set of CDM rows.

* Tests should rely on CDM tables only, not on live Jira.

## Data & State

* No schema changes: reuse CDM work tables from cdm-sinks-and-autoprovision-v1.
* New GraphQL queries and types for reading CDM data.
* New UI routes/components; no new back-end mutations.

## Constraints

* Keep the GraphQL surface minimal; we only need what the UI uses (projects list, items list, item detail).
* Keep UI performance reasonable by paginating lists and limiting default page size.
* Do not leak raw Jira-specific fields into the GraphQL surface; use CDM field names only.

## Acceptance Mapping

* AC1 → GraphQL CDM work queries exist and read from CDM tables.
* AC2 → UI shows CDM work items with filters and pagination.
* AC3 → Work item detail shows comments & worklogs when present.
* AC4 → E2E tests confirm list+detail flows using seeded/ingested data.

## Risks / Open Questions

* R1: Very large CDM tables could require further pagination/filter tuning; v1 keeps it simple and small.
* Q1: Whether to show multiple sources (e.g., Jira + future tools) mixed or separated; v1 can include `sourceSystem` field for later refinement.
