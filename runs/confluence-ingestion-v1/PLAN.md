# Plan — confluence-ingestion-v1

## Context refresh
- Intent/spec spell out adding Confluence ingestion units that mirror Confluence metadata datasets (pages/spaces/attachments) with per-space filters and incremental updatedAt watermarks.
- Current ingestion infrastructure already handles Jira units (GraphQL config, TS UI, planner, Python runtime). We need to extend the same pipeline for Confluence.

## High-level steps
1. **Ingestion unit + config plumbing**
   - Teach metadata API/static driver to surface Confluence ingestion units (from template dataset metadata) with proper cdm model references.
   - Extend GraphQL schema/resolvers + ingestion config store to include `ConfluenceIngestionFilter` (spaceKeys, updatedFrom) and expose any existing Jira filters concurrently.
   - Update ingestion UI forms/queries/types to render Confluence-specific controls (space picker leveraging catalog metadata, updatedFrom input).

2. **Planner / strategy + Temporal wiring**
   - Add Confluence-aware planning logic (likely in ingestion strategy modules) that expands configured space filters + KV watermarks into segments and passes them to the Temporal worker.
   - Ensure policies/mode/cdm sink compatibility checks cover Confluence units.
   - Persist per-space watermarks in KV (`metadata_ingestion_state`) keyed by endpoint+space.

3. **Python runtime handlers**
   - Implement Confluence ingestion execution in `metadata_worker.py` and supporting runtime_common helpers:
     - HTTP client to fetch pages (and optionally attachments) filtered by space + updatedAt cursor.
     - Raw mode: emit normalized raw records to staging.
     - CDM mode: reuse docs CDM mappers for spaces/pages/revisions; enforce sink compatibility.
   - Update tests (Python + TS + Playwright) and docs; run `pnpm ci-check`.

## Current status (2025-11-30)
- Steps 1–3 completed (planner/config/UI/runtime/CDM handlers shipped) and verified with manual Confluence/Jira runs.
- Temporal preview/test activities now enforce bounded retries and skip seeded datasets.
- `pnpm ci-check` still red on three metadata-auth specs; stabilization deferred per `docs/future-requirements/metadata-playwright-real-endpoints.md`.
