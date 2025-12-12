# SPEC — Signals surfaces & filters v1

## Problem

Signals are now:

- Modeled (SignalDefinition/SignalInstance),
- Evaluated at scale (paged CDM + reconciliation),
- Extensible via DSL and packs,
- Tied to CDM entities via `entityRef` (e.g. `cdm.work.item:…`, `cdm.doc.item:…`),

but they are largely invisible:

- There is no first-class Signals view to explore and filter SignalInstances.
- CDM work/doc detail pages do not show whether an entity has active signals.
- Brain/Workspace has no straightforward, focused API surface to fetch “signals for X” or “all current issues in Jira/Confluence/docs”.

We need:

- A generic GraphQL surface for exploring signals (with filters),
- A usable Signals UI for humans,
- Light surfacing of signals on CDM entity pages.

## Interfaces / Contracts

### 1. GraphQL: Signals exploration

We extend the GraphQL schema in metadata-api with:

1. A root query for listing signals:

```graphql
type SignalInstance {
  id: ID!
  definitionId: ID!
  definitionSlug: String!
  title: String!
  summary: String!
  severity: SignalSeverity!
  status: SignalStatus!         # e.g. OPEN, RESOLVED, SUPPRESSED
  entityRef: String!
  entityKind: String!
  sourceFamily: String
  entityCdmModelId: String
  entityCdmId: String
  createdAt: DateTime!
  updatedAt: DateTime!
  resolvedAt: DateTime
}

input SignalInstanceFilter {
  definitionSlugs: [String!]
  severity: [SignalSeverity!]
  status: [SignalStatus!]
  sourceFamily: [String!]
  entityKind: [String!]
  policyKind: [String!]          # if available via definition join
  from: DateTime                 # filter by createdAt/updatedAt >= from
  to: DateTime                   # <= to
  entityRef: String              # when fetching for a specific entity
}

type SignalInstancePage {
  rows: [SignalInstance!]!
  hasNextPage: Boolean!
  cursor: String
}

extend type Query {
  signalInstances(
    filter: SignalInstanceFilter
    first: Int = 50
    after: String
  ): SignalInstancePage!
}

Notes:
	•	Implementation may denormalize some fields (e.g., definitionSlug, sourceFamily, policyKind) via joins to SignalDefinition.
	•	entityCdmModelId and entityCdmId are parsed from entityRef for convenience (e.g. cdm.work.item:abc123).

	2.	Optionally, a focused query for “signals on a particular entity”:

extend type Query {
  signalsForEntity(
    entityRef: String!
  ): [SignalInstance!]!
}

Implementation may simply call into signalInstances with filter.entityRef.

2. GraphQL: minimal CDM detail integration

We add a derived field or GraphQL helper to CDM work/doc types:

type CdmWorkItem {
  # existing fields…
  signals: [SignalInstance!]!   # or a small page type if counts may be large
}

type CdmDocItem {
  # existing fields…
  signals: [SignalInstance!]!
}

Constraints:
	•	For v1, we can limit to “active” signals (status = OPEN) and/or cap the max number returned (e.g. top 10 by severity & recency).
	•	If the direct field is too heavy, we can instead provide a per-entity query and let the UI call that on demand; spec allows either.

3. UI: Signals view

We introduce a Signals view under the metadata-ui shell, accessible from the nav (exact label is implementation detail; suggest “Signals” or under “Knowledge Base”):

Core elements:
	•	Filters:
	•	Severity multi-select: ERROR, WARNING, INFO (using existing enum).
	•	Status multi-select: OPEN, RESOLVED, (optionally SUPPRESSED if present).
	•	Source family multi-select: jira, confluence, onedrive, etc.
	•	Entity kind: WORK_ITEM, DOC, DATASET, etc.
	•	Policy kind: FRESHNESS, OWNERSHIP, etc. (if populated).
	•	Definition slug/name search: free-text filter over slug/title.
	•	Time window: quick presets (e.g. “Last 24h”, “Last 7d”) using from/to.
	•	List/table:
	•	Columns (v1 suggestion):
	•	Severity (icon/pill),
	•	Status,
	•	Summary,
	•	Source (sourceFamily + entityKind),
	•	Entity (short label: issue key/doc title if available via details),
	•	Definition name/slug,
	•	Age or timestamp (createdAt / updatedAt).
	•	Actions per row:
	•	“View entity” → navigates to CDM entity detail (work/doc explorer) using entityCdmModelId + entityCdmId.
	•	“Open in source” → uses sourceUrl from CDM row if available; this may require an extra GraphQL lookup by entityRef.
	•	Behavior:
	•	Uses Signals GraphQL query with filters + pagination.
	•	Standard UX: local loading state on list, error feedback if query fails, global indicator consistent with other pages.
	•	Clicking a row or “View entity” opens the CDM detail in a new pane/route; Signals view state should be preserved when navigating back.

4. UI: CDM detail integration

On CDM Work and CDM Doc detail pages:
	•	Show a small signals section:
	•	For example, a sidebar card or tab with:
	•	A count of open signals,
	•	A small list of the top N signals (summary + severity),
	•	A link “View all signals” that opens the Signals view pre-filtered to that entity.
	•	Implementation:
	•	Either use the signals field on the CDM type, or call signalsForEntity(entityRef) / signalInstances with filter.entityRef.
	•	Reuse existing loading/error patterns (e.g., subtle skeletons or inline spinners; no jarring page reload).

5. Brain/Workspace affordances

This slug does not implement Brain/Workspace, but it should make future integration easy by:
	•	Ensuring signalInstances query returns enough context for an agent:
	•	definitionSlug, sourceFamily, entityRef, entityKind, timestamps, severity, status.
	•	Ensuring there is a simple “signals for entityRef” path (either direct query or filter).
	•	Keeping response shapes stable and documented.

Data & State
	•	No new SignalDefinition/SignalInstance tables; only new GraphQL types and resolvers.
	•	Optional new DB indexes on:
	•	(status, severity, source_family, created_at) to support common filters, if necessary.
	•	No changes to CDM table schemas (we rely on existing fields from previous CDM slugs).

Constraints
	•	Signals access must comply with existing auth/roles (e.g. only certain roles can see signals).
	•	Signals UI must not introduce excessive load:
	•	Reasonable default first size (e.g. 50),
	•	Basic pagination,
	•	No infinite scrolling for v1.

Acceptance Mapping
	•	AC1 → GraphQL signals exploration queries/types exist and support required filters.
	•	AC2 → Signals UI view exists with filters + table + navigation to CDM and source.
	•	AC3 → CDM work/doc detail pages show active signals and link to the Signals view.
	•	AC4 → Tests (unit + Playwright) cover core API and UI flows; no regressions.
	•	AC5 → pnpm ci-check passes.

Risks / Open Questions
	•	R1: Signals volume could grow large; v1 assumes moderate volume and relies on pagination. If volume is very high, we may need additional indexing or archival.
	•	R2: Per-CDM-page signals could become noisy if many packs are enabled; we may need severity-based truncation or a noisy definition review later.
	•	Q1: Where should the Signals view live in the nav (top-level vs under Knowledge Base)? This is mostly IA; this spec leaves exact placement flexible but requires at least one obvious entry point.
