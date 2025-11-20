## `intents/graphstore-identity-hardening/SPEC.md`

```markdown
# SPEC — GraphStore Identity Hardening

## Problem
Nodes/edges in the GraphStore can collide when logical identity is built from weak attributes (e.g., table name). Upcoming multi-tenant semantic ingestion increases this risk. We need a scope-aware, origin-aware identity that guarantees idempotent upserts and isolation across org/domain/project/team.

## Interfaces / Contracts

### A) Public GraphQL (additive only)
- **No breaking changes** to existing fields or IDs.
- Add two optional fields on Node/Edge types:
  - `identity { logicalKey, externalId, originEndpointId, originVendor }`
  - `scope { orgId, domainId, projectId, teamId }`
- Resolvers apply **default scope filters** using Keycloak claims; cross-scope access requires elevated role.

### B) DDL (nodes/edges)
Add columns:

- Common scope: `scope_org_id TEXT NOT NULL`, `scope_domain_id TEXT NULL`, `scope_project_id TEXT NULL`, `scope_team_id TEXT NULL`
- Origin: `origin_endpoint_id TEXT NULL`, `origin_vendor TEXT NULL`
- Identity: `logical_key TEXT NOT NULL`, `external_id JSONB NULL`  // vendor IDs used to construct logicalKey
- Housekeeping: `phase TEXT NULL` (`raw|hypothesis|normalized|enriched`), `provenance JSONB NULL`

Indexes:

- Nodes: `UNIQUE (logical_key)`, plus `btree(scope_org_id, type)`, and `gin(props)`
- Edges: `UNIQUE (logical_key)`, plus `btree(scope_org_id, edge_type)`, `btree(src_logical_key)`, `btree(dst_logical_key)`

### C) Logical identity builders
- **Node logicalKey** = `hash(type, scope_org_id, scope_project_id, origin_endpoint_id, external_id_parts...)`
  - Dataset/Table: `type=Dataset + org + project + endpoint + schema + table`
  - DocPage: `type=DocPage + org + endpoint + spaceKey + pageId`
  - WorkItem: `type=WorkItem + org + endpoint + projectKey + issueKey`
- **Edge logicalKey** = `hash(edge_type, source.logicalKey, target.logicalKey, role?)`

### D) Upsert & read semantics
- **Upserts**: `INSERT ... ON CONFLICT (logical_key) DO UPDATE SET props, provenance, phase, updated_at = now()`
- **Reads**: resolvers include `scope_org_id` (and optionally project/domain/team) filters by default.

### E) Backfill & collision handling
- Backfill job:
  1. Derive scope from existing labels/endpoint links; fallback to `scope_org_id='default'` and log for audit.
  2. Populate `external_id` from vendor payloads; compute `logical_key`.
  3. If prior “merged” records represent multiple origins/scopes, **split** into separate nodes:
     - Keep original `id` on the dominant origin; create new UUIDs for splits.
     - Mark both with `provenance.migration="graph-identity-hardening"` and attach a `collision_group_id`.
- Job is **idempotent**, checkpointed, and resumable.

## Data & State
- Additive columns only; no deletions.
- `logical_key` is the **storage uniqueness key**; legacy `id` remains stable for compatibility.
- All future writes MUST include scope + origin + external ids.

## Constraints
- Zero downtime; additive migrations with concurrent index creation.
- GraphQL behavior is scope-filtered by default.

## Acceptance Mapping
- AC1 → Multi-scope same-name asset ➜ distinct nodes (integration).
- AC2 → Replaying same write (same logicalKey) updates without duplicating (unit+integration).
- AC3 → Edges link by logicalKey; cross-tenant edge creation rejected (integration).
- AC4 → Backfill completes; collisions reported; provenance set (migration test).
- AC5 → GraphQL exposes `identity` and `scope` fields; existing queries green (contract test).

## Risks / Open Questions
- Legacy writers still upserting by display name — must be migrated to use logicalKey builder.
- Backfill performance on large graphs — run in batches with checkpoints.
```

---

## `intents/graphstore-identity-hardening/ACCEPTANCE.md`

```markdown
