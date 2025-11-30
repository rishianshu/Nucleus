# SPEC — CDM Explorer shell v1

## Problem

The CDM layer is growing:

- Work CDM (Jira) is live, with an existing Work Explorer UI.
- Docs CDM is defined and Confluence ingestion is wired, but there is no UI for CDM docs.
- Future sources (OneDrive, GitHub) will map into existing CDMs (work/docs) or new ones (code, people).

If each CDM gets its own custom explorer, we end up duplicating:

- list + search behavior,
- filters/pagination,
- selection and future bulk actions,
- plumbing for “open in KB / open in source / agent actions”.

We want one **CDM Explorer shell** that can host multiple CDM domains (work, docs, later code/people) with shared behaviors and pluggable domain-specific views.

## Interfaces / Contracts

### 1. Backend GraphQL layer

We do not discard existing work-specific types; we add an envelope that the shell can use.

#### 1.1. Generic CDM entity envelope

Introduce:

```graphql
scalar JSON

enum CdmDomain {
  WORK_ITEM      # cdm.work.item.*
  DOC_ITEM       # cdm.doc.item.*
  DOC_SPACE      # cdm.doc.space.*
  # future: CODE_REPO, CODE_FILE, PERSON, POLICY, ...
}

type CdmEntity {
  id: ID!
  domain: CdmDomain!
  sourceSystem: String!      # jira, confluence, onedrive, github, ...
  cdmId: String!             # underlying CDM id (cdm:doc:item:confluence:..., cdm:work:item:...)
  title: String
  createdAt: DateTime
  updatedAt: DateTime
  state: String              # e.g. status/state, if applicable
  data: JSON!                # domain-specific payload for the UI plugin
}

This is an envelope over underlying CDM models. Implementation can use:
	•	a union of existing CDM types internally, or
	•	direct queries against CDM sink tables.

We also define a filter type:

input CdmEntityFilter {
  domain: CdmDomain!
  sourceSystems: [String!]
  search: String
  tags: [String!]
  # domain-specific filters can be added later (work-specific & docs-specific filters remain on their typed queries)
}

And a connection:

type CdmEntityEdge {
  cursor: String!
  node: CdmEntity!
}

type CdmEntityConnection {
  edges: [CdmEntityEdge!]!
  pageInfo: PageInfo!
}

1.2. Queries
Add:

type Query {
  cdmEntities(
    filter: CdmEntityFilter!,
    first: Int!,
    after: String
  ): CdmEntityConnection!

  cdmEntity(id: ID!): CdmEntity

  # existing
  # cdmWorkItems(...)
  # cdmDocItems(...)
}

Rules:
	•	cdmEntities is additive; we do not remove or break existing work-specific queries.
	•	For Work tab, the UI can either:
	•	call cdmEntities(filter: {domain: WORK_ITEM, ...}), or
	•	continue to use cdmWorkItems under the hood where needed for richer fields.
	•	For Docs tab, the UI can:
	•	call cdmEntities(filter: {domain: DOC_ITEM, ...}) to drive the list.

2. UI shell

2.1. Navigation
Add a top-level entry:
	•	Sidebar item: CDM Explorer

Route:
	•	/cdm (or similar) with sub-tabs for:
	•	Work
	•	Docs

The shell provides:
	•	common header (title, help link),
	•	shared search input (wired to the domain plugin),
	•	shared pagination controls,
	•	shared “loading / empty / error” states,
	•	a domain selector if you later want to navigate across more domains.

2.2. Domain plugins
Define a simple frontend “plugin” contract (conceptual):

interface CdmDomainPlugin {
  domain: "WORK_ITEM" | "DOC_ITEM" | ...;
  getColumns(): ColumnDef<CdmEntity>[];
  getFilters(): FilterDef[];
  renderDetail(entity: CdmEntity): ReactNode;
}

Implement two plugins for v1:
	•	workItemPlugin (uses underlying work CDM data).
	•	docItemPlugin (uses underlying docs CDM data).

The shell:
	•	picks plugin by domain (tab selection),
	•	calls cdmEntities with that domain,
	•	renders table/list with plugin’s columns & filters,
	•	delegates row click to plugin’s renderDetail.

2.3. Work tab
Work tab must preserve current Work Explorer functionality:
	•	List view:
	•	columns: work item id/key, title, state/status, project, sourceSystem, updatedAt.
	•	Filters:
	•	project,
	•	sourceSystem (jira now, maybe GitHub later),
	•	state/status,
	•	free-text search.
	•	Detail:
	•	title, description, project, assignee, status,
	•	created/updated,
	•	link to source (e.g., “Open in Jira”),
	•	any extra fields you currently show.

Implementation:
	•	Reuse existing work explorer components.
	•	Refactor only the outer frame so they plug into the new CDM Explorer shell instead of a separate route.

2.4. Docs tab
Docs tab v1 should be simple but real:
	•	List view:
	•	columns: title, space, sourceSystem (confluence/onedrive), updatedAt.
	•	optional: doc_type (page/file).
	•	Filters:
	•	sourceSystem (confluence vs onedrive),
	•	space (multi-select, backed by CDM docs or metadata),
	•	free-text search (title).
	•	Detail:
	•	title,
	•	space/container,
	•	sourceSystem,
	•	created/updated,
	•	link to source (“Open in Confluence”),
	•	maybe a short excerpt if available (but full preview is not required in v1).

Implementation can:
	•	Use cdmEntities(domain: DOC_ITEM, ...) for list,
	•	For detail, either:
	•	use the data JSON envelope, or
	•	call a more specific cdmDocItem(id) if you have one (no change to schema required in this slug).

3. Error and loading behavior

Shared shell must handle:
	•	initial loading state (skeleton/loader).
	•	“no results” state (per domain).
	•	error boundary per tab (failure of cdmEntities doesn’t break the whole app).

These behaviors are shared across Work and Docs tabs.

Data & State
	•	No new DB tables.
	•	Potential new GraphQL types (CdmEntity envelope) backed by existing CDM sink tables/views.
	•	UI state remains client-side (filters, selected tab, selected item).

Constraints
	•	Do not remove or rename existing work-specific queries; keep them available for detailed views/tests.
	•	Keep queries paginated; no unbounded “select all CDM items” calls.
	•	Ensure the shell pattern is general enough for future domains (e.g. GitHub work items and docs mapping into the same views).

Acceptance Mapping
	•	AC1 → nav entry + shell + tabs.
	•	AC2 → work tab parity with existing explorer.
	•	AC3 → docs tab listing/filters/detail using CDM docs data.
	•	AC4 → generic GraphQL envelope query exists and is used by the shell without breaking existing APIs.

Risks / Open Questions
	•	R1: Some domains may need richer filters than CdmEntityFilter; we can let domain-specific views call domain-specific queries when necessary (shell is not a hard constraint).
	•	Q1: How to handle docs that are not yet ingested (metadata-only); v1 can simply show “no items” in docs tab when CDM docs sinks are empty.
