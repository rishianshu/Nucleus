# SPEC — KB relations UI surfacing v1

## Problem

Backend now emits a rich set of relations into KB:

- Structural: dataset→table→column containment, PK/FK edges.
- Semantic: work_links_work (Jira issue links), doc_contains_attachment (Confluence page attachments), drive_contains_item (OneDrive hierarchy), with drive_shares_with coming soon.

But the KB explorer UI and catalog views only surface a minimal subset (mostly schema and maybe PK/FK). Users and agents cannot see or navigate semantic relations even though they exist in KB.:contentReference[oaicite:8]{index=8}

We need to expose these relation kinds in the KB explorer and in key detail views, in a way that remains performant and understandable.

## Interfaces / Contracts

### 1. GraphQL: relation-aware KB queries

The KB explorer already queries KB via GraphQL. We extend it to:

- Accept an optional list of relation kinds when asking for edges.
- Return edges grouped by kind, with metadata.

Example GraphQL shape (conceptual):

```graphql
enum RelationKind {
  REL_CONTAINS_TABLE
  REL_CONTAINS_COLUMN
  REL_PK_OF
  REL_FK_REFERENCES
  REL_WORK_LINKS_WORK
  REL_DOC_CONTAINS_ATTACHMENT
  REL_DRIVE_CONTAINS_ITEM
  # REL_DRIVE_SHARES_WITH (when available)
}

type KbEdge {
  id: ID!
  kind: RelationKind!
  from: KbNode!
  to: KbNode!
  metadata: KbEdgeMetadata
}

type KbEdgeMetadata {
  linkType: String
  isFolder: Boolean
  role: String
  inherited: Boolean
  sourceSystem: String
}

type KbNode {
  id: ID!
  entityType: String!
  label: String!
  # existing fields...
  edges(kindFilter: [RelationKind!], direction: EdgeDirection, limit: Int = 50): [KbEdge!]!
}

enum EdgeDirection {
  INBOUND
  OUTBOUND
  BOTH
}
````

Requirements:

* `edges(kindFilter: ...)` must:

  * Respect a default `limit` (e.g., 50).
  * Be filterable by kind(s).
  * Support direction (INBOUND/OUTBOUND/BOTH).
* `RelationKind` enum must match the relation-kind registry used in backend.

### 2. KB explorer filters

KB explorer UI adds:

* A **relation kind facet**:

  * Checkboxes or tokens for:

    * PK/FK structural (grouped),
    * Work links,
    * Doc attachments,
    * Drive hierarchy,
    * (Ready for drive_shares_with).
  * Selecting kinds updates the GraphQL `kindFilter`.

* A **direction toggle**:

  * “Inbound / Outbound / Both” per selected node.

### 3. Node detail panel

When a node is selected in the explorer:

* Show neighbors grouped by relation family:

  * **Schema**:

    * Containing dataset/table/column,
    * PK columns,
    * FK relations (“references” and “referenced by” tables/columns).

  * **Work**:

    * Linked work items (blocks, relates, epic/parent).

  * **Docs**:

    * Attachments,
    * (Later) linked docs, linked issues.

  * **Drive**:

    * Parent folder/drive,
    * Child items.

For each neighbor list, include:

* Node label (e.g., issue key, doc title, table name).
* Edge metadata badge where relevant:

  * `linkType` (“blocks”, “relates”, etc.).
  * `isFolder` flag (icon).
  * `role` / `inherited` for shares (when wired).

### 4. Catalog / CDM detail views

We reuse the same KB relations in specific detail views:

* **Catalog table detail:**

  * Primary key section uses `rel.pk_of` edges for PK columns.
  * Foreign keys:

    * Outbound FKs: `rel.fk_references` edges from columns of this table to columns of other tables.
    * Inbound FKs: inverse edges.
  * “Related tables” section listing tables referenced by or referencing this table.

* **Doc detail (optional v1):**

  * If `rel.doc_contains_attachment` exists:

    * Attachments list with links/names.
  * If `rel.work_links_work` or doc↔issue links exist (depending on backend):

    * “Linked issues” section using those relation edges.

We don’t introduce new GraphQL fields; instead, Catalog detail resolvers reuse the KB GraphStore / relation-aware APIs introduced above.

## Data & State

* KB entities and edges are already persisted by `kb-relations-and-lineage-v1`.
* This slug mostly adds:

  * GraphQL fields/arguments to query relations safely.
  * UI state for:

    * Selected relation kinds,
    * Edge direction,
    * Neighbor lists.

No new persistence schema is required.

## Constraints

* GraphQL:

  * All additions are additive; no breaking schema changes.
  * Edge queries must be bounded (limit + filters).
* UI:

  * Avoid visual overload:

    * Default to a small subset of relation kinds (e.g., structural only) with the option to turn on semantic kinds.
  * Maintain existing KB explorer behavior when no relation filters are selected.

## Acceptance Mapping

* AC1 → Relation filters in KB explorer; mapping to `kindFilter` enum in GraphQL.
* AC2 → Node detail shows neighbors grouped by relation family with metadata.
* AC3 → Catalog table detail uses KB relations for PK/FK and related tables.
* AC4 → GraphQL tests verifying edge querying and relation kinds.
* AC5 → `pnpm ci-check` includes updated UI/Playwright tests.

## Risks / Open Questions

* R1: Some relation kinds (e.g., drive_shares_with) might not yet be emitted; UI must handle their absence gracefully.
* R2: Very dense graphs (e.g., Jira with heavy linking) could affect performance; we rely on reasonable defaults and limits.
* Q1: Whether to expose relation kinds only in KB explorer or also in global search facets; out-of-scope for v1.