## nucleus-architecture-survey-v1 Plan

1. **Gather architecture inputs**
   - Review platform/spark-ingestion endpoint abstractions, normalizers, collectors, metadata worker, and Prisma schema tables.
   - Inspect ingestion-core implementation (Temporal workflows, sinks) and note data flow.
   - Read relevant intents/specs + ADRs to capture terminology & drift.

2. **Document findings**
   - Produce MAP.md with diagrams/sections covering endpoint→workflow→sink flow, module lists, and glossary/drift.
   - Create ENDPOINTS.md table summarizing families/vendors, paths, capabilities, normalizers.
   - Create INGESTION_AND_SINKS.md describing ingestion envelope, sinks, gaps.

3. **Operational wrap-up**
   - Maintain LOG.md heartbeats during survey.
   - Ensure STATE.md + STORY updated after completion (per AGENT_CODEX).
