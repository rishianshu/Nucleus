# Run Card — kb-relations-and-lineage-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-relations-and-lineage-v1

SCOPE: Introduce a generic relation framework in the Knowledge Base (relation kinds + edges), and implement it for (1) JDBC structural relations (containment + PK/FK) and (2) one doc relation (doc↔issue or doc↔doc), exposing these relations via GraphQL and UI while keeping ingestion incremental and CI green.

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
- Relation-kind registry (code + docs)
- JDBC metadata ingestion emitting KB relations for containment + PK/FK
- Doc relation ingestion emitting KB relations for doc↔issue or doc↔doc
- GraphQL schema/resolvers exposing these relations for datasets/tables/columns and docs
- Updated KB admin console and Catalog/Docs/Work detail UIs to show relations
- New tests (unit, integration, e2e) and passing `pnpm ci-check`

LOOP:
Plan → Implement relation-kind registry → Wire JDBC structural relations to KB via generic model → Implement doc relation ingestion → Expose via GraphQL → Update UIs → Add tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 40–45 minutes with `{timestamp, done, next, risks}`.
Treat the heartbeat entry as the sole routine status output and immediately continue with the recorded `next` step—no conversational “still working?” messages in the main console.

STOP WHEN:
- All acceptance criteria in intents/kb-relations-and-lineage-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run/status for `kb-relations-and-lineage-v1`.
- Append a line to stories/kb-relations-and-lineage-v1/STORY.md describing outcomes and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep KB and GraphQL changes additive.
- Ensure ingestion changes remain incremental and idempotent.
- Prefer emitting relations from existing metadata/normalized payloads; do not add heavy heuristic parsers in this slug.

TASKS:
1) Implement the relation-kind registry and document it in the KB meta registry docs.
2) Extend JDBC metadata ingestion to emit KB relations (containment + PK/FK) using the generic relation model.
3) Implement one doc relation ingestion (doc↔issue or doc↔doc) using existing explicit link metadata and emit KB relations.
4) Add GraphQL fields/resolvers to expose relations for datasets/tables/columns and docs; update Catalog/Docs/Work detail and KB admin UI to visualize them.
5) Add tests and run `pnpm ci-check` until everything passes.
