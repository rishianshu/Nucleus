### `ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Planner delegates planning to endpoint/subsystem hooks
   - Type: unit / integration
   - Evidence:
     - `plan_metadata_jobs` in `metadata_service/planning.py` no longer branches on endpoint `family` or calls `_plan_jdbc_metadata_jobs` directly.
     - Planner attempts to resolve a metadata subsystem and calls `validate_metadata_config` and `plan_metadata_jobs` when present.
     - When no planning hook exists, planner logs `metadata_planning_unsupported` and returns `MetadataPlanningResult(jobs=[])`.

2) Jira planning moved out of planning.py
   - Type: integration
   - Evidence:
     - `planning.py` no longer references Jira-specific definitions or HTTP-specific planning helpers.
     - Jira metadata subsystem implements `validate_metadata_config` and `plan_metadata_jobs`.
     - Running Jira metadata collection produces the same catalog datasets as before.

3) JDBC planning opt-in only
   - Type: integration
   - Evidence:
     - At least one JDBC endpoint has a metadata subsystem that calls `_plan_jdbc_metadata_jobs` from its `plan_metadata_jobs` hook.
     - That endpoint’s metadata jobs match the previous behavior.
     - Another endpoint without such a hook does not plan metadata jobs (planner returns an empty list and logs).

4) Config validation hook is enforced
   - Type: unit / integration
   - Evidence:
     - A failing `validate_metadata_config` (e.g., missing Jira base_url) leads to:
       - `ok=False` and at least one error message,
       - planner returning `MetadataPlanningResult(jobs=[])`,
       - a log entry describing the configuration issue.
````

---

