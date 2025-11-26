1. Backend plumbing: Prisma `IngestionUnitConfig`, GraphQL schema/resolvers, ingest workflow + worker wiring (mode/policy/sink) ✅
2. UI + Driver polish: ingestion console drawer, dataset detail cards, default Jira template extras + metadata-gating/unit tests ✅
3. Verification: pytest (`test_jira_ingestion.py`), node tests (`ingestionCatalogGate`), Playwright (`pnpm check:metadata-auth`, `pnpm check:metadata-lifecycle`), and full `pnpm ci-check` ✅
