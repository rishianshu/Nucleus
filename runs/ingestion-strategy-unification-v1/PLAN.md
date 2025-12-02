1. Audit current ingestion planners/workers/workflows vs. unified requirements (adaptive planning, Source→Staging→Sink, metadata-first, CDM registry).
2. Implement unified adaptive planning interface across JDBC/Jira/Confluence (list_units/plan_incremental_slices) and align KV state schema.
3. Enforce Source→Staging→Sink in metadata_worker + Temporal activities (no batch records over Temporal; handles/stats only).
4. Wire CDM mapper registry and remove endpoint-specific CDM branches from metadata_worker; keep GraphQL additive.
5. Update GraphQL/workflow path to enforce metadata-first invariants and typed errors; align ingestion state handling.
6. Update tests (Py/TS/Playwright) and run pnpm ci-check; document decisions.
