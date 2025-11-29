# Regression Suite — Metadata/Confluence Programs

This suite aggregates the verification steps from every delivered slug so we can run a single regression surface before shipping. Each command below matches the evidence captured in the individual STORY/STATE files.

| Command | Covered Slugs | Notes |
| --- | --- | --- |
| `python3 -m pytest platform/spark-ingestion/packages/core/tests/test_cdm_docs.py platform/spark-ingestion/tests/test_cdm_confluence_mapper.py platform/spark-ingestion/tests/test_cdm_onedrive_mapper.py` | `cdm-docs-model-and-semantic-binding-v1` | Confirms the docs CDM models/mappers that power Semantic Confluence/Jira sources. |
| `pnpm --filter @apps/metadata-ui test` | `catalog-view-and-ux-v1`, `kb-admin-console-v1`, `kb-admin-console-polish-v1` | Runs the Vitest suites that cover catalog workspace UX, KB explorers, and supporting hooks. |
| `pnpm ci-check` | `semantic-confluence-source-v1`, `cdm-work-explorer-v1`, `cdm-ingestion-modes-and-sinks-v1`, `ingestion-filters-and-incremental-jira-v1`, `metadata-planner-endpoint-hooks-v1`, `semantic-jira-source-v1`, `endpoint-lifecycle`, `collection-lifecycle`, `metadata-identity-hardening`, `graphstore-identity-hardening`, `ingestion-source-staging-sink-v1` | Boots the Docker dev stack, runs the metadata workers, builds API/UI, and executes the metadata-auth + metadata-lifecycle Playwright suites. Covers all endpoint/collection/preview scenarios we’ve shipped. |
| `pnpm metadata:confluence:collect` | `semantic-confluence-source-v1` | Replays the Confluence collection harness to ensure catalog snapshots + preview data still hydrate correctly. Requires an auth token (see below). |

## Automation

Run everything with:

```bash
pnpm exec bash scripts/regression/run-slug-suite.sh
```

The helper script prints each step with the slugs it represents. Set `SKIP_CONFLUENCE_HARNESS=1` to avoid the harness or export `METADATA_AUTH_TOKEN` (or drop a token in `/tmp/metadata_token.txt`) so the harness runs automatically.

> **Tip:** the regression script assumes it is invoked from the repo root and uses the same environment variables as `pnpm ci-check` (Postgres, Temporal, Keycloak, etc.). Ensure `pnpm install` has been run and Docker is available locally.
