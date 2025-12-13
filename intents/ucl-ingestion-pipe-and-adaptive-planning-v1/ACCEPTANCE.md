# Acceptance Criteria

1) Bulk records do not traverse Temporal payloads; staging uses stageRef handles  
   - Type: integration  
   - Evidence:
     - Add a test harness ingestion run where the source produces >= 10,000 records
       (or equivalent bytes) across many pages.
     - Assert the Source activity returns only stageRef + stats, not the record array.
       (e.g., compile-time type + runtime assertion on activity return payload size).
     - Assert the workflow completes without Temporal payload errors.
     - Evidence paths:
       - UCL ingestion workflow test: `ucl/tests/ingestion_staging_ref_test.go` (example)

2) Confluence and Jira probing + planning produce deterministic slice plans  
   - Type: unit|integration  
   - Evidence:
     - Confluence:
       - Probe returns N spaces (stubbed) and estimated page counts (best-effort).
       - Plan returns slices per space (and optionally page ranges) bounded by pageLimit.
     - Jira:
       - Probe returns configured projects and estimated issue counts (best-effort).
       - Plan returns slices per project (and optionally time windows) bounded by pageLimit.
     - The same inputs must produce the same sliceId list deterministically.
     - Evidence paths:
       - `ucl/tests/confluence_planner_test.go`
       - `ucl/tests/jira_planner_test.go`

3) End-to-end multi-slice ingestion run executes Source→Stage→Sink with progress reporting  
   - Type: integration  
   - Evidence:
     - Use stub endpoints:
       - Source endpoint emits records per slice into staging.
       - Sink endpoint consumes staging batches and persists counts into a test sink.
     - Run StartOperation(INGESTION_RUN) and poll GetOperation until terminal.
     - Assert:
       - status transitions QUEUED→RUNNING→SUCCEEDED,
       - progress counters show slicesTotal>1, slicesDone increments,
       - sink persisted recordCount equals staged recordCount.
     - Evidence path:
       - `ucl/tests/ingestion_e2e_progress_test.go`

4) Hardening negative cases return correct structured errors and never claim success  
   - Type: integration  
   - Evidence:
     - Staging unavailable:
       - configure object-store missing, attempt large run → FAILED with E_STAGING_UNAVAILABLE.
     - Bad auth:
       - source returns E_AUTH_INVALID → FAILED with retryable=false.
     - Unreachable:
       - source returns E_ENDPOINT_UNREACHABLE or E_TIMEOUT → FAILED with retryable=true.
     - In all cases GetOperation must not return SUCCEEDED.
     - Evidence path:
       - `ucl/tests/ingestion_negative_cases_test.go`
