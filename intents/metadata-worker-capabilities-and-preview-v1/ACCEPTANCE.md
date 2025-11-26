## `ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Jira-specific planning removed from metadata_worker
   - Type: unit / integration
   - Evidence:
     - `platform/spark-ingestion/temporal/metadata_worker.py` no longer contains functions like `_should_use_http_metadata` or `_collect_http_metadata_records`.
     - There are no direct references to Jira dataset definitions in metadata_worker.
     - A new planner (`plan_metadata_jobs`) is used instead.

2) Jira catalog output unchanged
   - Type: integration
   - Evidence:
     - Run Jira metadata collection for a test endpoint before and after the refactor.
     - The set of `catalog.dataset` records and their core fields (dataset identity, basic schema) are identical.

3) HTTP-aware preview works
   - Type: integration
   - Evidence:
     - Calling the `previewDataset` activity for a known Jira dataset returns non-empty rows and a timestamp.
     - Calling it for a JDBC dataset continues to work as before (same shape).
     - Calling it for a dataset whose endpoint lacks `metadata.preview` fails with a clear “preview not supported” error.

4) Capability-driven behavior enforced
   - Type: unit / integration
   - Evidence:
     - Tests show that metadata collection and preview paths:
       - inspect endpoint/template capabilities (`metadata.collect`, `metadata.preview`),
       - no longer branch on hard-coded template ids in metadata_worker.
````

---

