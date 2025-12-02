[] Audit current planners (JDBC/Jira/Confluence) and metadata_worker/workflow to pinpoint gaps vs unified design (adaptive slices, staging-only data plane, metadata-first).
[] Define/standardize KV checkpoint schema for incremental state across sources.
[] Draft/implement unified plan_incremental_slices for Jira/Confluence using shared interface; ensure list_units conforms.
[] Enforce Source→Staging→Sink in metadata_worker/activities (no bulk records over Temporal); return handles + stats only.
[] Integrate CDM mapper registry; remove endpoint-specific CDM code paths in metadata_worker; keep GraphQL additive.
[] Tighten GraphQL ingestion invariants (dataset exists/enabled) with typed errors; keep backwards compatible.
[] Update tests (Py/TS/Playwright) and run pnpm ci-check.
