# SPEC — Docs access graph and RLS v1

## Problem

Current state:

- Confluence and OneDrive docs are ingested into CDM Docs and visible in the Docs Explorer.
- KB (GraphStore) exists and holds entities (datasets, docs, endpoints, etc.) but has weak or no explicit ACL edges.
- Access control is implicit:
  - at the connector level (what endpoints you configure),
  - or at the environment level (who has access to Nucleus itself).

Missing:

- Explicit modeled relationships: user/group/team ↔ doc access (allow edges).
- Resolver-level enforcement: filter docs by principal’s effective access.
- Admin visibility into ACL state for debugging and governance.

We need to ingest access edges into KB, and apply them as row-level security (RLS) for CDM Docs queries and the Docs Explorer.

## Interfaces / Contracts

### 1. KB ACL model (nodes & edges)

Define new KB semantics (conceptual types; actual schema can be encoded in existing GraphStore):

- Nodes:
  - `principal:user` — a human user (origin: IdP / source apps).
    - `id` (global user id),
    - `source` (`confluence`, `onedrive`, `jira`, `idp`),
    - attributes (email, displayName, etc.).
  - `principal:group` — group/team from source systems.
    - `id`, `source`, attributes (name, type).
  - `doc` — existing CDM Docs entities already mapped into KB (via CDM registry).
    - `id` (CDM doc id), `source`, path, etc.

- Edges:
  - `HAS_MEMBER`:
    - `principal:group` → `principal:user` (user membership).
  - `CAN_VIEW_DOC`:
    - `principal:user` → `doc`,
    - `principal:group` → `doc`.
  - Optionally `CAN_EDIT_DOC` or `CAN_ADMIN_DOC` (v1 may only need `CAN_VIEW_DOC`).

All edges include:

- `source_system` (e.g., confluence/onedrive),
- `synced_at` timestamp,
- `scope` (if needed, e.g., inherited from space/folder vs direct sharing).

We can implement these using existing KB APIs (e.g., `graphStore.upsertEntity`, `graphStore.upsertEdge`) with new `type`/`label` strings.

### 2. ACL ingestion units

For each docs connector (Confluence, OneDrive):

- Define an **ACL ingestion unit** that:

  - For Confluence:
    - Lists spaces and pages already ingested as CDM docs.
    - Calls Confluence APIs (or stub) to fetch:
      - page-level restrictions (view/edit),
      - space-level groups/users.
    - For each doc, computes:
      - direct + inherited viewers (users/groups),
      - writes `CAN_VIEW_DOC` edges:
        - `group -> doc`, `user -> doc`.
      - writes `HAS_MEMBER` edges for groups/users if not already present.

  - For OneDrive:
    - For each ingested doc (CDM docs item), fetches:
      - permissions via Graph (`/drive/items/{id}/permissions` in real, stub in CI).
    - Computes:
      - which users/groups/links map to principals.
      - writes `CAN_VIEW_DOC` edges accordingly.

- ACL ingestion runs use the unified ingestion framework:

  - Implemented as separate ingestion units (e.g., `confluence.acl`, `onedrive.acl`).
  - Use Source → Staging → Sink pattern for ACL rows or call KB directly from worker (since payloads are small).
  - Incremental: only refresh ACLs for changed docs/spaces/drives (bounded by time or change tokens).

We can keep v1 simple:

- Use Source→KB directly for ACLs (no heavy staging needed) because ACL payload is small compared to doc bodies.
- Still orchestrated via Temporal as ingestion runs.

### 3. Effective access: deriving principal → doc

At query time, for a given Nucleus principal (the logged-in metadata user):

- Map Nucleus principal to source principals:
  - For example:
    - Nucleus user → email → `principal:user` nodes in KB.
    - Optionally group membership from IdP (if available), or just rely on source-side groups.

- Effective access is:

  - All docs `d` such that:
    - there exists `u` (user principal for this Nucleus user) where:
      - `u -[:CAN_VIEW_DOC]-> d`, OR
      - there exists `g` (group) where:
        - `g -[:HAS_MEMBER]-> u` and `g -[:CAN_VIEW_DOC]-> d`.

Implementation options:

- Precompute doc → allowed principal ids in an index (e.g., denormalized table) for fast filtering during CDM Docs queries, OR
- Query KB at runtime and cache results per principal.

For v1, we can:

- Use a denormalized RLS table keyed by `(principal_id, doc_id)` or by `(principal_id, dataset_id)` with a join back to CDM docs.
- This table can be maintained by the ACL ingestion runs.

### 4. CDM Docs resolver changes (RLS)

Add a “secured” variant or an RLS flag in the CDM Docs GraphQL resolvers:

- New field / argument:

  ```graphql
  type CdmDocsQuery {
    docs(filter: DocsFilter, secured: Boolean = true): [Doc!]!
  }
````

Behavior:

* `secured = true` (default for UI):

  * Resolve current principal (Nucleus user).
  * Look up allowed doc ids for that principal from RLS index or KB.
  * Filter docs so only allowed ones are returned.

* `secured = false`:

  * Internal/admin-only usage (may require a special role).
  * Returns all docs matching filter, ignoring RLS.

Resolvers must:

* Enforce RLS on the server side; UI should not rely on client filtering.
* Use role checks to prevent non-admins from bypassing RLS with `secured=false`.

### 5. Docs Explorer UI

Update the Docs Explorer:

* Always call the secured CDM Docs query for regular users.

* Show an indicator in the doc detail panel:

  * Example fields:

    * `accessLevel`: `PRIVATE | SHARED | PUBLIC | UNKNOWN`,
    * `sharedWithSummary`: e.g., `2 groups, 5 users`.

* A simple v1 mapping:

  * `PRIVATE` — only the principal (or very small set) has access.
  * `SHARED` — some groups/users beyond the owner; show `n groups / m users`.
  * `PUBLIC` — accessible to “tenant-wide” group or equivalent.

Admin KB views:

* Extend existing KB admin console to:

  * Filter nodes/edges by type (`principal:user`, `principal:group`, `doc`).
  * Show `CAN_VIEW_DOC` edges for a given doc or principal for debugging.

## Data & State

* New KB edges: `HAS_MEMBER`, `CAN_VIEW_DOC` with timestamps.
* Optional RLS index table for fast doc filtering by principal:

  * Columns: `principal_id`, `doc_id`, `source`, `last_updated_at`.

ACL ingestion runs:

* Similar run metadata as other ingestion units (run status, stats, errors).

## Constraints

* KB changes must be additive (no breaking changes to existing node/edge types).
* ACL ingestion must be incremental:

  * Accepts a time window or change token to avoid re-syncing ACLs for all docs every run.

## Acceptance Mapping

* AC1 → ACL ingestion units and KB edges exist for Confluence/OneDrive.
* AC2 → CDM Docs resolver enforces RLS via KB/ACL data.
* AC3 → Docs Explorer hides unauthorized docs.
* AC4 → Docs Explorer shows basic access info in detail view.
* AC5 → KB admin tools can inspect edges.
* AC6 → `pnpm ci-check` green with new tests.

## Risks / Open Questions

* R1: Mapping Nucleus principals to source principals may be non-trivial in multi-IdP environments; v1 can assume a single email-based mapping.
* R2: ACL explosion for very large tenants; v1 can scope to a subset of spaces/drives.
* Q1: Whether to enforce RLS for agents differently than UI (e.g., extra filters at retrieval time); v1 can share the same RLS layer.
