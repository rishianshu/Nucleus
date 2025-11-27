### `RUNCARD.md`

```markdown
# Run Card — metadata-planner-endpoint-hooks-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: metadata-planner-endpoint-hooks-v1

SCOPE: Refactor metadata planning so that endpoints/metadata-subsystems own dataset discovery and job planning via hooks, remove HTTP/Jira-specific logic from `planning.py`, and eliminate JDBC as an implicit default.

INPUTS:
- intents/metadata-planner-endpoint-hooks-v1/INTENT.md
- intents/metadata-planner-endpoint-hooks-v1/SPEC.md
- intents/metadata-planner-endpoint-hooks-v1/ACCEPTANCE.md
- platform/spark-ingestion/packages/metadata-service/src/metadata_service/planning.py
- runtime_common/endpoints/*
- runtime_common/metadata_subsystems/*
- docs/meta/nucleus-architecture/endpoint-HLD.md
- runs/metadata-planner-endpoint-hooks-v1/*

OUTPUTS:
- runs/metadata-planner-endpoint-hooks-v1/PLAN.md
- runs/metadata-planner-endpoint-hooks-v1/LOG.md
- runs/metadata-planner-endpoint-hooks-v1/QUESTIONS.md
- runs/metadata-planner-endpoint-hooks-v1/DECISIONS.md
- runs/metadata-planner-endpoint-hooks-v1/TODO.md
- Updated planner, metadata subsystems (Jira + at least one JDBC), and tests.

LOOP:
Plan → Refactor planner hooks → Implement subsystem hooks (Jira + JDBC) → Add config validation → Test → Heartbeat (≤ 150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 minutes with `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking ambiguity is logged in QUESTIONS.md and sync/STATE.md set to `blocked`.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/metadata-planner-endpoint-hooks-v1/STORY.md.

GUARDRAILS:
- Do not change Temporal activity signatures or catalog record shapes.
- Do not move endpoint-specific logic into `planning.py`.
- Keep `pnpm ci-check` under existing limits.
- Do not modify *_custom.* files or // @custom blocks.

TASKS:
1) Introduce `MetadataConfigValidationResult` and subsystem hooks (`validate_metadata_config`, `plan_metadata_jobs`) in the appropriate modules.
2) Refactor `plan_metadata_jobs` in `metadata_service/planning.py` to use subsystem hooks and remove HTTP/Jira-specific functions and JDBC fallback.
3) Implement Jira metadata subsystem hooks using existing Jira metadata definitions and ensure catalog output matches previous behavior.
4) Implement at least one JDBC metadata subsystem that calls `_plan_jdbc_metadata_jobs` from its planning hook; ensure its behavior matches previous catalog output.
5) Add unit/integration tests for:
   - planner delegation and logging,
   - Jira planning via subsystem,
   - JDBC planning via subsystem,
   - config validation failure path.
```
