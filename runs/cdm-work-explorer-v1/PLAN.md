# Plan

1. **Understand CDM data access + schema hooks** – Inspect existing CDM sink writer/schema (cdmSink.ts, cdmProvisioner.ts, runtime_core/cdm/work.py) and determine how to read CDM tables (Prisma vs raw SQL). Decide on data access abstraction + connection reuse for GraphQL resolvers.
2. **Implement GraphQL CDM work queries** – Add schema types + resolvers for projects list, paginated work item list with filters, and work item detail (comments + worklogs). Ensure resolvers query CDM tables, paginate, and reuse auth patterns.
3. **Build metadata UI explorer** – Add CDM navigation entry; implement work item list view with filters + detail route (comments/worklogs). Handle loading/empty states per design system.
4. **Testing + docs + CI** – Add unit/integration tests for new resolvers; add Playwright coverage for list/detail flows (seed CDM data). Update docs (INGESTION_AND_SINKS/CDM model) with explorer info, run `pnpm ci-check`, and update run artifacts (TODO/LOG/STATE/STORY).
