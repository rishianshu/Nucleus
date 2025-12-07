# Run Card — kb-relations-and-lineage-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-relations-and-lineage-v1

SCOPE: Enrich the Knowledge Base with structural relations for JDBC datasets (dataset→table→column containment, primary keys, and foreign keys), expose them via GraphQL, and surface them in the KB admin console and Catalog UI, while keeping ingestion incremental and CI green.

INPUTS:
- intents/kb-relations-and-lineage-v1/INTENT.md
- intents/kb-relations-and-lineage-v1/SPEC.md
- intents/kb-relations-and-lineage-v1/ACCEPTANCE.md
- apps/metadata-api/src/schema.ts
- apps/metadata-api/src/graph/*
- apps/metadata-ui/*
- platform/spark-ingestion/*
- docs/meta/nucleus-architecture/*
- runs/kb-relations-and-lineage-v1/*

OUTPUTS:
- runs/kb-relations-and-lineage-v1/PLAN.md
- runs/kb-relations-and-lineage-v1/LOG.md
- runs/kb-relations-and-lineage-v1/QUESTIONS.md
- runs/kb-relations-and-lineage-v1/DECISIONS.md
- runs/kb-relations-and-lineage-v1/TODO.md
- Extended JDBC metadata ingestion emitting KB nodes/edges for dataset/table/column and PK/FK relations
- GraphQL schema/resolvers exposing these relations
- Updated Catalog and KB admin UI to visualize PK/FK and containment
- New tests (unit/integration/e2e) and passing `pnpm ci-check`

LOOP:
Plan → Extend KB schema/types for structural relations → Implement JDBC metadata extraction and KB upserts → Add GraphQL fields/resolvers → Update Catalog UI and KB admin console → Add/adjust tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/kb-relations-and-lineage-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run and status for `kb-relations-and-lineage-v1`.
- Append a line to stories/kb-relations-and-lineage-v1/STORY.md describing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep GraphQL changes additive (no breaking changes).
- Keep KB schema changes additive; do not remove or rename existing node/edge types.
- Preserve ingestion performance; avoid O(N²) behaviour for large schemas.

TASKS:
1) Define/encode KB node and edge types for dataset/table/column containment and PK/FK relations; register them in the KB meta registry.
2) Extend JDBC metadata ingestion to extract PK/FK info and upsert corresponding nodes/edges into KB, idempotently.
3) Add GraphQL fields/resolvers to expose tables, columns, PKs, and inbound/outbound FKs for datasets/tables.
4) Update Catalog dataset/table detail and KB admin console UIs to display PK/FK relationships; add tests.
5) Run `pnpm ci-check` and refine until all new and existing tests pass.

