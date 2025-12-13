- Establish staging abstraction + workflow scope
  - Review current ucl-core/ucl-worker ingestion, staging, and operation state handling.
  - Capture gaps vs. ACs (stageRef-only flow, probe/plan hooks, progress counters).

- Implement staging providers and envelope
  - Add StagingProvider interface with memory + object-store implementations and selection policy.
  - Ensure ingestion activities/workflows use stageRef handles only (no bulk payloads).

- Add adaptive probing/planning + progress
  - Implement ProbeIngestion/PlanIngestion for Jira/Confluence with deterministic slice IDs and bounded pages.
  - Wire operation progress counters for slices + staged/sunk totals and error codes.

- End-to-end ingestion workflow
  - Update ingestion orchestration to run Source→Stage→Sink per slice using stageRefs, fail-closed when staging unavailable.
  - Enforce record envelope for staged batches.

- Testing and CI
  - Add AC-focused tests: large-run staging safety, deterministic planners, e2e progress, negative cases.
  - Run relevant Go/unit checks for ucl-core/ucl-worker.
