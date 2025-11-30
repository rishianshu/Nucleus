# Decisions – confluence-ingestion-v1

## 2025-11-30
- **Defer Playwright catalog/ingestion spec fixes**  
  - `pnpm ci-check` still fails three metadata-auth specs because they rely on seeded datasets and real Jira units.  
  - Implemented guardrails (sample dataset preview block + non-retryable Temporal failures), but stabilizing the specs requires a broader rework.  
  - Captured follow-up requirements in `docs/future-requirements/metadata-playwright-real-endpoints.md`. Future slug should wire tests to dynamically created endpoints/datasets before re-enabling. 
