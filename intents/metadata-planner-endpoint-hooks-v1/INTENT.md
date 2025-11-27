- title: Metadata planner endpoint hooks v1
- slug: metadata-planner-endpoint-hooks-v1
- type: techdebt
- context:
  - platform/spark-ingestion/packages/metadata-service/src/metadata_service/planning.py
  - runtime_common/endpoints/* (JDBC + HTTP/semantic)
  - runtime_common/metadata_subsystems/* (Jira + others)
  - docs/meta/nucleus-architecture/endpoint-HLD.md
- why_now: The current metadata planner uses a hard-coded family check (HTTP vs JDBC) and treats JDBC as a global fallback. HTTP planning is effectively Jira-specific. This conflicts with the endpoint-centric design: endpoints/subsystems should own dataset discovery and job planning, and there should be no implicit “JDBC default” if an endpoint cannot plan metadata.
- scope_in:
  - Change `plan_metadata_jobs` in `metadata_service/planning.py` so it delegates planning to endpoint/metadata-subsystem hooks instead of branching on family and defaulting to JDBC.
  - Introduce an optional `plan_metadata_jobs` hook on the metadata subsystem (or endpoint class) that returns `MetadataPlanningResult` or `None`.
  - Add a `MetadataConfigValidationResult` dataclass and an optional `validate_metadata_config` hook on the metadata subsystem to validate/enrich endpoint config before planning.
  - Move Jira-specific dataset discovery and planning logic out of `planning.py` and into the Jira metadata subsystem.
  - Keep the existing `_plan_jdbc_metadata_jobs` logic as a helper that JDBC endpoints can call from their own hooks, not as a planner default.
- scope_out:
  - Any changes to metadata_worker or Temporal activity signatures (covered by other slugs).
  - Preview refactor (covered by metadata-worker-capabilities-and-preview-v1).
  - CDM models or ingestion behavior.
- acceptance:
  1. `plan_metadata_jobs` no longer branches on template family or calls `_plan_jdbc_metadata_jobs` as a fallback; it only uses endpoint/subsystem hooks.
  2. Jira metadata planning is performed via a subsystem hook, not via HTTP-specific code in `planning.py`.
  3. Metadata subsystems can validate configs via `validate_metadata_config`, and invalid configs cause metadata planning to abort with meaningful logs.
  4. JDBC endpoints that want generic information_schema scanning call `_plan_jdbc_metadata_jobs` from their own planning hook.
- constraints:
  - No behavior change to catalog content for existing endpoints (Jira + JDBC) aside from log text/location.
  - No change to MetadataPlanningResult or MetadataJob structure.
- non_negotiables:
  - There must be no implicit JDBC default; if an endpoint does not implement a planning hook, planner must return no jobs and log the absence.
  - All endpoint-/source-specific planning logic must live in endpoints/subsystems, not in `planning.py`.
- refs:
  - docs/meta/nucleus-architecture/endpoint-HLD.md
- status: in-progress