### `RUNCARD.md`

```markdown
# Run Card — metadata-worker-capabilities-and-preview-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: metadata-worker-capabilities-and-preview-v1

SCOPE: Refactor `metadata_worker.py` to delegate metadata planning and preview to endpoint/subsystem capabilities, removing Jira-specific branching from the worker and preserving catalog/preview behavior.

INPUTS:
- intents/metadata-worker-capabilities-and-preview-v1/INTENT.md
- intents/metadata-worker-capabilities-and-preview-v1/SPEC.md
- intents/metadata-worker-capabilities-and-preview-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/endpoint-HLD.md
- docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- docs/meta/nucleus-architecture/jira-metadata-HLD.md
- docs/meta/nucleus-architecture/jira-metadata-LLD.md
- runs/metadata-worker-capabilities-and-preview-v1/*

OUTPUTS:
- runs/metadata-worker-capabilities-and-preview-v1/PLAN.md
- runs/metadata-worker-capabilities-and-preview-v1/LOG.md
- runs/metadata-worker-capabilities-and-preview-v1/QUESTIONS.md
- runs/metadata-worker-capabilities-and-preview-v1/DECISIONS.md
- runs/metadata-worker-capabilities-and-preview-v1/TODO.md
- Updated metadata_worker, planner module, Jira metadata subsystem, and tests

LOOP:
Plan → Survey current metadata_worker + Jira metadata subsystem → Introduce planner abstraction → Refactor worker → Implement HTTP preview → Update tests → Heartbeat (≤ 150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are satisfied, OR
- A blocking question is logged in QUESTIONS.md and sync/STATE.md is set to `blocked`.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/metadata-worker-capabilities-and-preview-v1/STORY.md.

GUARDRAILS:
- Do not change GraphQL or Temporal activity signatures.
- Do not move bulk data into TS; all ingestion data-plane stays in Python.
- Do not modify *_custom.* files or // @custom blocks.
- Keep `pnpm ci-check` within current limits.

TASKS:
1) Extract Jira-specific metadata job planning from metadata_worker into a planner in the Jira metadata subsystem or a shared planning module.
2) Implement `plan_metadata_jobs(request, logger)` and update `_collect_catalog_snapshots_sync` to use it for all endpoints.
3) Enhance preview logic to resolve the dataset’s endpoint/template and, when `metadata.preview` is supported, dispatch to endpoint/subsystem preview; retain JDBC fallback.
4) Add/adjust tests:
   - Jira catalog datasets unchanged.
   - `previewDataset` works for Jira and JDBC; unsupported datasets fail cleanly.
```

