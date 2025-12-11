# Acceptance Criteria

1) Evaluator processes CDM rows page-by-page  
   - Type: unit / integration  
   - Evidence:
     - `evaluateWorkStale` and `evaluateDocOrphan` (or their successors) no longer build arrays of all work/doc rows in memory.
     - CDM accessors use a page-iteration pattern (e.g., async generator or explicit paging loop).
     - Tests ensure that evaluation still visits all matching CDM rows when multiple pages are required.

2) All relevant SignalInstances are considered (no 200-instance cap)  
   - Type: unit / integration  
   - Evidence:
     - Reconciliation code no longer uses a single `listInstances` call with `limit = MAX_PAGE_SIZE` to determine updates/resolutions.
     - Either:
       - Instance paging is implemented (e.g., `listInstancesPaged`) and used to see all OPEN instances, or
       - A run-token strategy (`sourceRunId`) plus store-level "resolve stale instances" implementation is used.
     - Tests seed > 200 OPEN instances for one definition and verify:
       - New matches update existing instances beyond the first page.
       - Non-matching OPEN instances beyond the first page can be RESOLVED.

3) Unknown or unsupported DSL types are explicitly skipped  
   - Type: unit  
   - Evidence:
     - If a SignalDefinition has a `definitionSpec` with unknown `spec.type`, the evaluator:
       - Adds an entry to `skippedDefinitions` with a reason like `unsupported spec type …`.
       - Does not throw or write any instances for that definition.
     - Unit tests for parse + evaluate paths confirm this behavior.

4) Definition-level errors do not abort other definitions  
   - Type: integration  
   - Evidence:
     - At least one test creates:
       - One valid SignalDefinition,
       - One SignalDefinition that throws during evaluation (e.g., by forcing a CDM query error or malformed config).
     - Running `evaluateAll` yields:
       - The valid definition slug in `evaluatedDefinitions`,
       - The broken definition slug in `skippedDefinitions` with an error reason.
       - The process does not throw globally; the summary is returned.

5) Documentation updated for evaluator behavior and strategy  
   - Type: docs  
   - Evidence:
     - A document (e.g., `docs/meta/nucleus-architecture/SIGNALS_EVALUATOR_SCALING.md` or an updated Signals section) explains:
       - That evaluators operate page-by-page over CDM.
       - How instance reconciliation works (paging vs run-token).
       - That signals are slow-path and eventually consistent, not realtime.
     - The doc mentions that callers can use `dryRun` for safe inspection.

6) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes with the new evaluator logic and tests.
     - No existing tests are disabled or skipped to make this slug pass.
