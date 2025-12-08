# Run Card — onedrive-delegated-auth-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: onedrive-delegated-auth-v1

SCOPE: Add a delegated (browser sign-in) auth mode for the OneDrive connector so that developers/admins can connect their own OneDrive using OAuth and run preview/ingestion, while keeping stub mode as the CI default and preserving the unified ingestion/staging design.

INPUTS:
- intents/onedrive-delegated-auth-v1/INTENT.md
- intents/onedrive-delegated-auth-v1/SPEC.md
- intents/onedrive-delegated-auth-v1/ACCEPTANCE.md
- apps/metadata-api/*
- apps/metadata-ui/*
- platform/spark-ingestion/*
- runtime_common/endpoints/*
- docs/meta/nucleus-architecture/*
- runs/onedrive-delegated-auth-v1/*

OUTPUTS:
- runs/onedrive-delegated-auth-v1/PLAN.md
- runs/onedrive-delegated-auth-v1/LOG.md
- runs/onedrive-delegated-auth-v1/QUESTIONS.md
- runs/onedrive-delegated-auth-v1/DECISIONS.md
- runs/onedrive-delegated-auth-v1/TODO.md
- Updated OneDrive endpoint descriptor/config (authMode, delegatedConnected)
- New GraphQL mutations + callback handler for delegated auth
- Secure token storage integration for delegated tokens
- Updated ingestion/preview flows to honor delegated mode
- Tests (unit/integration/e2e) and passing `pnpm ci-check`

LOOP:
Plan → Extend endpoint descriptor and schema → Implement delegated auth start/callback → Wire token storage into OneDrive SourceEndpoint → Ensure preview/ingestion work in delegated mode → Keep stub as CI default → Update tests → Run `pnpm ci-check` → Heartbeat.

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in intents/onedrive-delegated-auth-v1/ACCEPTANCE.md are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md is set to blocked.

POST-RUN:
- Update sync/STATE.md Last Run for `onedrive-delegated-auth-v1`.
- Append a line to stories/onedrive-delegated-auth-v1/STORY.md summarizing key outcomes.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Keep GraphQL changes additive only.
- Do not log or expose secrets or tokens.
- Preserve Source → Staging → Sink ingestion structure.

TASKS:
1) Extend OneDrive endpoint descriptor and GraphQL types to support `authMode` and delegated status.
2) Implement the delegated auth start/callback flow and secure token storage.
3) Wire delegated tokens into OneDrive SourceEndpoint for preview/ingestion.
4) Ensure stub mode remains CI default and requires no external Graph or secrets.
5) Update/add tests and run `pnpm ci-check` until green.


