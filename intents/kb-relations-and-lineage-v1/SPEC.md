# SPEC — KB relations and lineage v1 (PK/FK and structural edges)

## Problem

Right now Nucleus can show:

- Datasets and some basic metadata from JDBC sources.
- KB nodes for various entities (datasets, endpoints, etc.).
- A KB admin console that lists nodes/edges but with limited structural richness.

Missing:

- Explicit, queryable **containment** relations: dataset → table → column.
- Explicit **primary key** and **foreign key** relations at table/column level.
- UI surfaces to inspect “what references what” (lineage-like views) and for agents to traverse via GraphQL.

JDBC metadata (information_schema and vendor views) already provides most of this. We need to:

- Normalize those relations,
- Emit them into KB using existing GraphStore APIs,
- Expose them via GraphQL,
- And surface them in the KB console and Catalog detail screens.

## Interfaces / Contracts

### 1. KB schema: nodes & edges

Use existing GraphStore mechanism but with new types/labels.

**Nodes (types):**

- `dataset`:
  - Represents a logical dataset (already present).
  - Attributes: id, name, domain, endpoint, etc.

- `table`:
  - Represents a physical or logical table/view.
  - Attributes: id, dataset_id, schema_name, table_name, type.

- `column`:
  - Represents a column of a table.
  - Attributes: id, table_id, column_name, ordinal_position, data_type, nullable, etc.

**Edges (labels):**

- `CONTAINS_TABLE`:
  - `dataset` → `table`.

- `CONTAINS_COLUMN`:
  - `table` → `column`.

- `HAS_PRIMARY_KEY`:
  - `table` → `column` (or to a PK node; v1 can attach directly to column).

- `REFERENCES_COLUMN`:
  - `column` → `column` (FK->PK).
  - Attributes:
    - `fk_name`,
    - `on_delete`, `on_update` if available.

All edges should carry:

- `source_system` (e.g., `jdbc.postgres`),
- `synced_at` timestamp,
- Optional `confidence` if needed later (v1 can be 1.0).

Encode these using existing GraphStore APIs, e.g.:

- `graphStore.upsertEntity({ id, type: 'column', ... })`
- `graphStore.upsertEdge({ fromId, toId, type: 'REFERENCES_COLUMN', ... })`

### 2. JDBC metadata extraction

Extend the **JDBC metadata ingestion path** to emit these relations.

Sources:

- `information_schema.tables` (or equivalent) for table list.
- `information_schema.columns` for columns.
- PK info:
  - Postgres: `pg_constraint` + `pg_attribute` or `information_schema.table_constraints` / `key_column_usage`.
- FK info:
  - Postgres: `information_schema.referential_constraints` / `key_column_usage`.

Design:

- During metadata collection for JDBC endpoints (already emitting datasets/tables/columns into `MetadataRecord` / catalog), add a phase that:

  - For each dataset/table/column:
    - Emit/update KB `dataset`, `table`, `column` nodes.
    - Emit `CONTAINS_TABLE` and `CONTAINS_COLUMN` edges.

  - For each PK:
    - For each PK column, emit `HAS_PRIMARY_KEY` from `table` to `column`.

  - For each FK:
    - Resolve FK column(s) and referenced PK column(s).
    - Emit `REFERENCES_COLUMN` edges from FK column to PK column.

Consider partial or composite keys:

- v1 can either:
  - Emit an edge per column pair (FK_col → PK_col), OR
  - Represent composite keys as separate nodes (out-of-scope for v1; keep it simple and per column).

The ingestion must remain **incremental**:

- If table or column disappears, we may:
  - Keep edges but mark them inactive, or
  - Detect deletion and remove edges. v1 can focus on “add/update”, with rely-on-reload for deletions.

### 3. GraphQL exposure

Update GraphQL schema (metadata-api) to expose structural relations:

- On dataset type:

  ```graphql
  type Dataset {
    id: ID!
    name: String!
    tables: [Table!]!      # existing or new
  }
````

* On table type:

  ```graphql
  type Table {
    id: ID!
    name: String!
    columns: [Column!]!
    primaryKeyColumns: [Column!]!
    inboundForeignKeys: [ForeignKey!]!
    outboundForeignKeys: [ForeignKey!]!
  }

  type ForeignKey {
    name: String
    fromTable: Table!
    fromColumns: [Column!]!
    toTable: Table!
    toColumns: [Column!]!
    onDelete: String
    onUpdate: String
  }
  ```

Resolvers:

* Use KB as the primary source:

  * Look up edges from `dataset` to `table` (CONTAINS_TABLE).
  * Edges from `table` to `column` (CONTAINS_COLUMN).
  * `HAS_PRIMARY_KEY` for `primaryKeyColumns`.
  * `REFERENCES_COLUMN` edges for inbound/outbound FKs.

Optionally cache or denormalize for performance.

### 4. UI: KB admin and Catalog views

KB admin console:

* Add filters for relation types:

  * “Show FK edges”, “Show PK edges”, etc.
* Allow selecting a table node and see:

  * Its columns,
  * Its PK columns,
  * FKs to/from other tables.

Catalog dataset/table detail:

* Dataset detail:

  * Show list of tables (from KB).
  * Maybe a small count of inbound/outbound FKs for the dataset.

* Table detail:

  * Add sections:

    * Primary Key: list of columns.
    * Foreign Keys:

      * Outbound FKs (this table → others).
      * Inbound FKs (others → this table).

The UI can reuse existing GraphQL resolvers; no new data sources.

## Data & State

* KB nodes: `dataset`, `table`, `column`.
* KB edges: `CONTAINS_TABLE`, `CONTAINS_COLUMN`, `HAS_PRIMARY_KEY`, `REFERENCES_COLUMN`.
* Existing catalog metadata (e.g., `MetadataRecord`) remains the underlying source; KB is a semantic overlay.

## Constraints

* KB changes must be additive; do not rename or delete existing types/edges.
* For large schemas, ensure ingestion:

  * Batches writes to KB,
  * Avoids N² behaviour (e.g., we generate one FK edge per actual FK column relation, not cross joins).

## Acceptance Mapping

* AC1 → KB contains structural nodes/edges for seeded JDBC schemas.
* AC2 → GraphQL exposes these relations in dataset/table/column types.
* AC3 → UI shows FK/PK info in dataset/table detail.
* AC4 → KB admin console can inspect relations.
* AC5 → Ingestion remains incremental; CI stays green.

## Risks / Open Questions

* R1: Different JDBC vendors represent PK/FK info differently; v1 may target Postgres and a subset of others, with fallbacks.
* R2: Handling composite keys elegantly may require a future slug (e.g., dedicated PK node).
* Q1: Whether to ingest relations for all domains or only for specific ones (e.g., `catalog.dataset`); v1 can scope to catalog JDBC datasets only.
