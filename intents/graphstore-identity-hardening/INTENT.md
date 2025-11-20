- title: GraphStore identity hardening (scope-safe logical keys; no collisions)
- slug: graphstore-identity-hardening
- type: techdebt
- context:
  - GraphStore (Postgres-backed kb_node/kb_edge or equivalent)
  - apps/metadata-api graph resolvers/DAOs
  - Keycloak claims → scoped tenancy (org/domain/project/team)
- why_now: We observed graph collisions where different producers (and scopes) upserted the same logical names (e.g., table names) into a single record. Dataset identity is already hardened; GraphStore must adopt scope- and origin-aware logical identity so upcoming semantic sources (Jira/Confluence/OneDrive) cannot collide or overwrite each other.
- scope_in:
  - Add explicit scope vector columns on nodes/edges: orgId, domainId?, projectId?, teamId?.
  - Introduce **logicalKey** for nodes (type + scope + origin + external identity) and for edges (type + source/target logicalKeys).
  - DB: unique index on logicalKey; idempotent upserts by logicalKey.
  - Backfill: compute logicalKey for existing rows; detect/split prior collisions with provenance.
  - GraphQL: additive `identity { logicalKey, externalId, originEndpointId, originVendor }` and `scope { orgId, domainId, projectId, teamId }`.
  - Resolvers: default **scope-filtered reads** from caller claims; cross-scope requires elevated role.
- scope_out:
  - Public `id` renumbering or breaking GraphQL; graph algorithms; vector/graph alignment (separate slugs).
- acceptance:
  1. Two identical natural assets from different scopes/endpoints persist as **distinct nodes** (no merge).
  2. Upserts by logicalKey are **idempotent** (replays update, not duplicate).
  3. Edges connect via logicalKey; cross-tenant connections are rejected by default.
  4. Backfill migrates existing data safely and reports any collisions handled.
  5. GraphQL exposes additive `identity` and `scope` fields; existing queries remain valid.
- constraints:
  - Additive only (DB + GraphQL); zero downtime migration; `make ci-check` < 8 minutes.
- non_negotiables:
  - No cross-tenant leakage; every write must include scope + origin.
  - Unique logicalKey enforced at the DB level.
- refs:
  - scoped-knowledge-and-signals-story-v1
  - semantic-sources-trio-story-v1
- status: in-progress
