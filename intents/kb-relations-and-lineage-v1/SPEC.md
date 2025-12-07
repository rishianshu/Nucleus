# SPEC — KB relations and lineage v1 (generic relation framework)

## Problem

Current KB state:

- We have entities: endpoints, datasets, tables, columns, docs, work items, etc.
- We have some edges but they’re ad-hoc and mostly structural.
- The earlier “relations & lineage” idea focused almost entirely on JDBC PK/FK.

Missing:

- A **generic way** to represent relations across domains:
  - Structural (PK/FK, containment),
  - Cross-entity (doc→issue, doc→doc, doc→dataset),
  - Future signals.
- A **registry** so producers and consumers agree on relation semantics.
- UI and GraphQL support that treat relations as **first-class metadata**, not one-off hacks.

We need:

1. A relation-kind registry and generic relation representation in KB.
2. At least two concrete relation families implemented end-to-end:
   - JDBC structural relations (containment + PK/FK).
   - One doc relation (e.g. Confluence page ↔ Jira issue) using existing explicit links.

## Interfaces / Contracts

### 1. Relation-kind registry

Define a registry that enumerates supported relation kinds with human + machine semantics.

Conceptual model:

```ts
type RelationKindId =
  | "rel.contains"
  | "rel.contains.table"
  | "rel.contains.column"
  | "rel.pk_of"
  | "rel.fk_references"
  | "rel.doc_links_issue"
  | "rel.doc_links_doc";

type RelationKind = {
  id: RelationKindId;
  label: string;            // human name
  description: string;
  fromTypes: string[];      // allowed from entity types
  toTypes: string[];        // allowed to entity types
  symmetric?: boolean;      // for rel.doc_links_doc etc.
};
````

Implementation:

* Code-level registry (e.g. a TypeScript map or JSON manifest under `docs/meta/nucleus-architecture/kb-meta-registry-v1.md` + runtime).
* Optionally mirrored into KB meta nodes (so KB can be introspected).

V1 must support at least:

* `rel.contains` / `rel.contains.table` / `rel.contains.column` (dataset→table→column).
* `rel.pk_of` (table → column).
* `rel.fk_references` (fk column → pk column).
* `rel.doc_links_issue` (doc → work item) *or* `rel.doc_links_doc` (doc ↔ doc).

### 2. Generic relation edges in KB

Represent relations as KB edges with:

```ts
type RelationEdge = {
  id: string;
  kind: RelationKindId;
  fromId: string;          // KB entity id
  toId: string;            // KB entity id
  sourceSystem: string;    // "jdbc.postgres", "confluence", "jira", ...
  strength?: number;       // optional weight/score
  tags?: string[];         // optional labels, e.g. ["explicit-link", "schema"]
  createdAt: Date;
  updatedAt: Date;
};
```

Stored via existing GraphStore API:

* `graphStore.upsertEntity({ id, type, ... })`
* `graphStore.upsertEdge({ id, type: kind, fromId, toId, props })`

No new datastore; just a consistent use of `type` for `RelationKindId` and some common props.

### 3. JDBC structural relations

Extend JDBC metadata ingestion so that when we collect JDBC metadata and emit catalog datasets:

* For each dataset:

  * Create/ensure KB `dataset` entity.
* For each table:

  * Create KB `table` entity.
  * Add `rel.contains.table` edge: `dataset -> table`.
* For each column:

  * Create KB `column` entity.
  * Add `rel.contains.column` edge: `table -> column`.

For PKs:

* For each PK constraint, for each PK column:

  * Add `rel.pk_of` edge: `table -> column`.

For FKs:

* For each FK constraint:

  * For each FK column referenced:

    * Add `rel.fk_references` edge: `fkColumn -> pkColumn`.

Notes:

* For composite keys, v1 can emit one edge per column pair.
* Upserts must be idempotent: re-running metadata collection should not create duplicates.

### 4. Doc relation (Confluence ↔ Jira or doc ↔ doc)

Pick one concrete relation that already has **explicit linking**:

* Option A: `rel.doc_links_issue`:

  * Confluence pages that embed or link a Jira issue via structured macro or a known field.
* Option B: `rel.doc_links_doc`:

  * Confluence page linking another page via a structured reference.

Specification for A (example):

* During Confluence metadata or ingestion:

  * For each page, inspect its metadata/normalized payload for:

    * A list of Jira issue keys (if present from existing Jira macro extractions); or
    * A structured “linked issues” field in normalized records.
  * For each `(page, issueKey)` pair:

    * Resolve or create KB entities:

      * `doc` (Confluence page),
      * `work_item` (Jira issue, from CDM or KB).
    * Emit `rel.doc_links_issue` edge: `doc -> work_item`.

In tests, we can seed a small fixture:

* One Confluence doc with a known Jira issue link.
* One Jira issue ingested into CDM Work / KB.
* One `rel.doc_links_issue` edge connecting them.

### 5. GraphQL exposure

Expose relations via GraphQL in two main places:

1. **Catalog / schema view** (JDBC):

   ```graphql
   type Dataset {
     id: ID!
     name: String!
     tables: [Table!]!
   }

   type Table {
     id: ID!
     name: String!
     columns: [Column!]!
     primaryKeyColumns: [Column!]!
     inboundForeignKeys: [ForeignKey!]!
     outboundForeignKeys: [ForeignKey!]!
   }

   type Column {
     id: ID!
     name: String!
     table: Table!
     referencedBy: [Column!]!   # via rel.fk_references edges
     references: [Column!]!
   }
   ```

   Resolvers read KB relations:

   * `rel.contains.*`, `rel.pk_of`, `rel.fk_references`.

2. **Doc/work view**:

   ```graphql
   type Doc {
     id: ID!
     title: String!
     linkedIssues: [WorkItem!]!    # via rel.doc_links_issue
     # or
     linkedDocs: [Doc!]!           # via rel.doc_links_doc
   }
   ```

   Resolvers read KB `rel.doc_links_issue` / `rel.doc_links_doc` edges.

### 6. UI: KB admin and detail views

* KB admin console:

  * Allow filtering edges by `kind` (`rel.pk_of`, `rel.fk_references`, `rel.doc_links_issue`, etc.).
  * When clicking a node (table/doc), show:

    * its neighbors grouped by relation kind.

* Catalog dataset/table detail:

  * Show PK/FK info as in the earlier PK/FK-only design.
  * Optionally show “related docs” or “linked issues” in a side panel using the doc relation.

* CDM Docs or Work Explorer:

  * For the chosen doc relation:

    * Show linked issues/docs in the detail pane.

## Data & State

* KB entities: `dataset`, `table`, `column`, `doc`, `work_item` (some already exist).
* KB edges with `type = RelationKindId`: stored via GraphStore.
* Relation-kind registry stored at:

  * Code level (TS/JSON),
  * Optionally mirrored as meta nodes.

## Constraints

* Keep KB schema changes additive; no renames/deletes of existing types.
* Ensure ingestion batch writes and upserts are bounded and idempotent.

## Acceptance Mapping

* AC1 → relation-kind registry implemented and queryable.
* AC2 → JDBC ingestion emits containment + PK/FK relations consistently.
* AC3 → a doc relation (doc↔issue or doc↔doc) is emitted.
* AC4 → GraphQL exposes these relations for schema + docs.
* AC5 → KB admin console can filter and inspect relations by kind.
* AC6 → CI remains green.

## Risks / Open Questions

* R1: Confluence↔Jira link extraction may be limited by what the current normalizer exposes; v1 can use explicit fixture fields.
* R2: Composite keys semantics; v1 can treat them as per-column edges.
* Q1: Which doc relation is easiest to implement now (doc↔issue vs doc↔doc); choice can be finalized during implementation based on current data.
