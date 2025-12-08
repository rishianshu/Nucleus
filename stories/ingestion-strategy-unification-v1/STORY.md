# STORY — ingestion-strategy-unification-v1

- 2025-12-04T09:45Z: Run completed. Python ingestion worker now enforces Source→Staging→Sink with staging handles (no bulk records over Temporal); adaptive planners implemented for JDBC/Jira/Confluence with shared IngestionPlan/Slice contract; metadata-first GraphQL invariants added; CDM registry path in place. Playwright regression (metadata-auth, metadata-lifecycle) and pnpm ci-check passed. KB/CDM explorer assertions tightened to ensure schema-only payloads and filter effects. Next: package changes into commit/PR.
