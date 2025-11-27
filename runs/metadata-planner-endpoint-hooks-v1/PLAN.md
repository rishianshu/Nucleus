# Plan — metadata-planner-endpoint-hooks-v1

1. **Baseline + instrumentation**
   - Review current planner + subsystem implementations to identify touch points (done during boot recording; keep notes handy).
2. **Planner refactor**
   - Introduce `MetadataConfigValidationResult` + optional hook detection; remove HTTP family branching + `_plan_http_endpoint_jobs`/`_discover_datasets`. Keep `_plan_jdbc_metadata_jobs` as helper for subsystems.
3. **Subsystem hooks**
   - Update Jira metadata subsystem to implement `validate_metadata_config` + `plan_metadata_jobs` using existing dataset definitions. Ensure normalized params + job creation matches previous behavior.
   - Update JDBC subsystems (Postgres + Oracle) to implement the hooks, delegating to `_plan_jdbc_metadata_jobs`; ensure another endpoint without hook triggers unsupported log.
4. **Docs & tests**
   - Add/refresh unit tests (planner delegation, validation failure, unsupported log). Update docs/spec references if needed. Run pytest + pnpm checks per acceptance.
