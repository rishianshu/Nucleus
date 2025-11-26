# Plan — metadata-worker-capabilities-and-preview-v1

1. **Survey & baseline**
   - Read current `metadata_worker.py`, preview helpers, Jira metadata subsystem, docs.
   - Capture list of Jira-specific logic to eliminate + datasets/preview expectations.
2. **Planner abstraction**
   - Add metadata planner module (capability-driven) + hook worker to it.
   - Ensure Jira subsystem registers planner + worker no longer imports Jira constants; regression tests for catalog equality.
3. **HTTP-aware preview**
   - Resolve dataset → endpoint → capability chain; dispatch to new preview helpers with fallback to existing JDBC implementation.
   - Implement Jira preview helper (issues/projects, etc.) respecting limit + dataset id mapping.
4. **Docs, tests, verification**
   - Update specs/docs to mention capability-driven planner + preview contract.
   - Add unit/integration tests (Python + TS if needed), rerun relevant suites (pytest, node, pnpm check/ci-check if required).
