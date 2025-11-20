## PLAN — graphstore-identity-hardening

### Current context
- GraphStore today is just another `MetadataRecord` domain (`graph.entity` / `graph.edge`) stored via `MetadataStore`. There are **no scope or origin columns**, so collisions happen when two tenants upsert similarly named entities.
- Prisma schema only has `MetadataRecord`; no dedicated graph tables. File-store deployments mirror this JSON layout.
- GraphQL schema currently exposes catalog/endpoint types only; no additive `identity` / `scope` fields yet; ingestion (`syncRecordToGraph` in `temporal/activities.ts`) writes entities/edges without logical keys.

### Target outcomes (map to AC)
1. **Storage**: Add dedicated `graph_nodes` / `graph_edges` tables (Prisma models + SQL migration) with scope/origin/logical key columns + unique indexes. File-store fallback needs equivalent manifest layout.
2. **Identity builders**: Deterministic logical key helpers per entity/edge type that combine scope + origin endpoint + vendor IDs (AC1/AC2). Inputs validated so missing scope/origin is impossible.
3. **GraphStore API changes**: `GraphEntityInput`/`GraphEdgeInput` extended with `identity` + `scope` args. `MetadataGraphStore` persists logicalKey columns, enforces uniqueness, and lists entities filtered by caller scope (AC1–AC3). Edge creation rejects cross-scope pairs.
4. **GraphQL & resolvers**: Schema gets additive `identity`/`scope` fields plus optional filters; resolvers hydrate them and rely on Keycloak claims for scope filtering (AC5).
5. **Backfill tooling**: Script/job migrates existing nodes/edges → new tables, derives scope/origin/logical keys, splits collisions, records provenance, and emits a summary report (AC4).
6. **Tests**: Unit tests for builders, integration tests for scoped writes/reads + idempotent upserts, migration/backfill tests, and GraphQL contract tests proving compatibility.

### Work breakdown & sequencing
1. **Design + DDL**
   - Introduce Prisma models `GraphNode` / `GraphEdge` (and file-store JSON equivalents) with columns from SPEC.
   - Generate SQL migration (`apps/metadata-api/prisma/migrations/...`) to create tables + indexes; add `prisma/schema.prisma` updates.
   - Update `@metadata/core` Prisma client typings if needed.
2. **Core identity builders**
   - Create `packages/metadata-core/src/graph/identity.ts` (or similar) exporting helpers:
     - `buildGraphScopeVector(tenantClaims)` → normalized scope struct.
     - `buildGraphNodeLogicalKey(input: GraphNodeIdentityInput)` returning stable string + externalId payload.
     - `buildGraphEdgeLogicalKey(...)`.
   - Add Jest/Vitest coverage for collision avoidance + determinism.
3. **GraphStore implementation**
   - Extend `GraphEntityInput`/`GraphEdgeInput` types with new identity/scope/origin fields.
   - Update `MetadataGraphStore` to:
     - Persist/read from Prisma/File store using new tables/structures.
     - Upsert by `logical_key` via `ON CONFLICT` (Prisma `upsert` by unique).
     - Enforce scope filtering (`scope_org_id` match) during `get/list`.
     - Reject edge writes when scope mismatch or source/target outside caller scope.
   - Ensure metadata-store-backed fallback serializes new fields.
4. **GraphQL schema/resolvers**
   - Add `GraphNode`/`GraphEdge` types (or extend existing) with `identity` and `scope` subfields.
   - Update resolvers (where GraphStore is used) to require scope context + to expose new fields without breaking older clients.
   - Wire ingestion pipeline (`syncRecordToGraph`) to call identity builders and pass scope/origin to `GraphStore`.
5. **Backfill job**
   - Implement CLI/Temporal script: iterates existing graph records, populates new tables, handles collisions (split or annotate), sets `provenance.migration`, and writes JSON report to `.artifacts`.
   - Ensure idempotency via checkpoints (e.g., `backfill_state` table or resume markers).
6. **Testing + verification**
   - Unit tests for builders + GraphStore logic (idempotent upserts, scope isolation).
   - Integration tests hitting Prisma store/backfill logic.
   - GraphQL contract test to assert additive fields and scope filtering defaults.
   - Document run artifacts (LOG/TODO) and prep instructions for manual verification.

### Risks / unknowns
- GraphQL schema currently lacks explicit Graph types; need to confirm consumer expectations + ensure additive change accepted.
- Prisma migrations must be additive + zero downtime; need to confirm existing data volume for backfill to size batches.
- File-store fallback may not be heavily used but still must gain scope fields; ensure compatibility with seeds/tests.
- Temporal ingestion/backfill concurrency: ensure new transactions avoid locking large tables.
