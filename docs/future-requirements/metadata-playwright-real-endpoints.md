# Metadata Playwright – Real Endpoint Coverage

## Context
- Slug `confluence-ingestion-v1` refreshed seeded catalog logic and moved preview fetching to cached/sample rows.
- Metadata workspace/catalog Playwright specs (`tests/metadata-auth.spec.ts` at lines 67 and 127) still rely on pre-seeded Confluence datasets, so they break once previews stop calling live sources.
- To keep the slug moving we deferred reworking those specs; they now need deterministic endpoints/datasets created at runtime and possibly UI helpers that can scope to those endpoints.

## Follow-up Requirements
1. **Test data orchestration**
   - Add lightweight helpers that register a metadata-capable endpoint, seed catalog rows, and clean up afterwards.
   - Ensure those helpers are resilient when run under `pnpm ci-check` (stack restarts, new tokens, etc.).
2. **Preview UX assertions**
   - Update specs to assert against cached preview rows when live preview is disabled and only hit Temporal when explicitly requested.
   - Provide data-test hooks (`metadata-preview-empty`, `metadata-preview-table`) that survive rerenders during preview polling.
3. **Ingestion status spec**
   - The “jira ingestion console shows healthy units for admin” spec currently hits `E_INGESTION_UNIT_NOT_FOUND` when fake collections are enabled.
   - Provide a fake ingestion activity or bypass path under `METADATA_FAKE_COLLECTIONS=1` so the spec can assert the UI state without requiring a live Jira instance.

## Exit Criteria
- Running `npx playwright test tests/metadata-auth.spec.ts --project=chromium` passes locally and under `pnpm ci-check`.
- No spec depends on seeded Confluence datasets; everything uses on-demand endpoints/datasets.
- Preview/ingestion specs are stable across reruns (≤5% flake rate measured over 10 consecutive CI runs).
