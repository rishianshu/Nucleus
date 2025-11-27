# TODO — metadata-planner-endpoint-hooks-v1

- [x] Refactor `metadata_service/planning.py` to use subsystem hooks (remove HTTP/Jira branch + add validation/planning delegation).
- [x] Implement Jira subsystem `validate_metadata_config` + `plan_metadata_jobs` hooks.
- [x] Implement JDBC subsystem hooks (Postgres + Oracle) delegating to `_plan_jdbc_metadata_jobs`.
- [x] Add planner unit tests for delegation/validation/unsupported cases.
- [x] Run `pnpm ci-check` (covers metadata-auth + metadata-lifecycle flows) for regression evidence.
