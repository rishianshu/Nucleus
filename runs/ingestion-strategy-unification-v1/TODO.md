[x] Audit current planners (JDBC/Jira/Confluence) and metadata_worker/workflow to pinpoint gaps vs unified design (adaptive slices, staging-only data plane, metadata-first).
[x] Define/standardize KV checkpoint schema for incremental state across sources.
[x] Draft/implement unified plan_incremental_slices for Jira/Confluence using shared interface; ensure list_units conforms.
[x] Enforce Source→Staging→Sink in metadata_worker/activities (no bulk records over Temporal); return handles + stats only.
[x] Integrate CDM mapper registry; remove endpoint-specific CDM code paths in metadata_worker; keep GraphQL additive.
[x] Tighten GraphQL ingestion invariants (dataset exists/enabled) with typed errors; keep backwards compatible.
[x] Update tests (Py/TS/Playwright) and run pnpm ci-check.
