# Run Card — docs-access-graph-and-rls-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: docs-access-graph-and-rls-v1

SCOPE: Ingest doc ACLs from Confluence and OneDrive into KB as access edges (user/group → doc), and enforce row-level security (RLS) in CDM Docs resolvers and the Docs Explorer so users only see docs they are allowed to access, while keeping KB schema and CI stable.

INPUTS:
- intents/docs-access-graph-and-rls-v1/INTENT.md
- intents/docs-access-graph-and-rls-v1/SPEC.md
- intents/docs-access-graph-and-rls-v1/ACCEPTANCE.md
- runtime_core/cdm/docs/*
- apps/metadata-api/src/schema.ts
- apps/metadata-api/src/graph/*
- apps/metadata-ui/*
- platform/spark-ingestion/*
- docs/meta/nucleus-architecture/*
- runs/docs-access-graph-and-rls-v1/*

OUTPUTS:
- runs/docs-access-graph-and-rls-v1/PLAN.md
- runs/docs-access-graph-and-rls-v1/LOG.md
- runs/docs-access-graph-and-rls-v1/QUESTIONS.md
- runs/docs-access-graph-and-rls-v1/DECISIONS.md
- runs/docs-access-graph-and-rls-v1/TODO.md
- ACL ingestion units for Confluence and OneDrive docs
- KB edges for principals and docs (HAS_MEMBER, CAN_VIEW_DOC)
- RLS-aware CDM Docs resolvers with `secured` behavior
- Updated Docs Explorer UI with access metadata and RLS
- Updated KB admin console capabilities for ACL debugging
- New/updated tests (unit/integration/e2e) and a passing `pnpm ci-check`

LOOP:
Plan → Define/confirm KB ACL schema → Implement ACL ingestion for Confluence and OneDrive → Add/adjust KB resolvers and/or RLS index → Wire secured CDM Docs resolvers → Update Docs Explorer UI and KB admin views → Add tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/docs-access-graph-and-rls-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run and status for `docs-access-graph-and-rls-v1`.
- Append a line to stories/docs-access-graph-and-rls-v1/STORY.md describing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep KB changes additive and backward compatible.
- Enforce RLS in resolvers; do not rely on client-only filters.
- Preserve the unified ingestion infrastructure (Temporal, Source → Staging → Sink) for any ACL flows that use ingestion.

TASKS:
1) Define/encode KB ACL node and edge types (principal:user, principal:group, doc, HAS_MEMBER, CAN_VIEW_DOC) and register them in the KB meta registry.
2) Implement ACL ingestion units for Confluence and OneDrive that populate KB access edges incrementally.
3) Implement RLS in CDM Docs resolvers using KB/ACL data (or a derived RLS index) with `secured=true` by default.
4) Update Docs Explorer to use secured queries and display basic access metadata in the detail pane; extend KB admin views to inspect ACL edges.
5) Add unit/integration/Playwright tests for ACL ingestion and RLS; run `pnpm ci-check` until everything passes.
