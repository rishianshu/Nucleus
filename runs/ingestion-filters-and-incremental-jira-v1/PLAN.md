# Plan

1. **Extend config + schema with Jira filter model**
   - Prisma migration to add `filter` JSON column, config store serialization helpers.
   - GraphQL types + mutations + resolvers to expose/validate Jira filters (including Jira-only constraint).
2. **Metadata UI integration**
   - Fetch Jira metadata dimensions via GraphQL options query.
   - Render filter drawer (projects/statuses/assignees/updated-from) and wire to configure mutation.
3. **Transient state + Temporal plumbing**
   - Build KV-backed transient state helper in TS; update `start/completeIngestionRun` + workflow to pass filter + state to Python.
4. **Jira runtime incremental behavior**
   - Update `jira_http` handlers to accept filters + per-project state, manage per-dimension cursors, and return updated state.
   - Add unit tests covering filter persistence/options, transient state helpers, and Jira runtime behavior.
5. **Docs + CI**
   - Document filter/TransientState contract (INGESTION_AND_SINKS + Jira HLD/LLD).
   - Run targeted tests + `pnpm ci-check`, then update STORY/STATE artifacts.
