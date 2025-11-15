# Spec: Temporal Orchestration Platform

## Context & Goal
- Coordinate ingestion, enrichment, and export workflows across tenants using Temporal while enforcing namespace isolation and consistent logging.
- Provide explicit lifecycle semantics for `endpointSyncWorkflow`, including scheduling controls, backoff, and cursor advancement.
- Align orchestration metadata with KV checkpoints, log taxonomy, and Agent house rules.

## Scope
- Temporal namespace configuration and metadata.
- Task queues for TypeScript (`meta-ts`) and Python (`meta-py`) workers.
- Concrete workflow families we operate today:
  - **Metadata ingestion** (`metadataCollectionWorkflow`, endpoint harvesters).
  - **Preview jobs** (`previewDatasetWorkflow`).
  - Future orchestration (backfills, exports) must adopt the same guardrails.
- Workflow lifecycle definitions, schedules, and manual controls (pause/resume/reschedule/trigger).
- Cursor and advance rules (powered by the semantic KV store) for deterministic replay.
- Backoff policies, log/metric expectations, and alignment with `Agent.md`.

## Namespaces
- Create namespaces per environment (`dev`, `staging`, `prod`) and per workload family (`harvesters`, `backfills`, `experiments`), yielding combinations like `prod.harvesters`.
- Namespace metadata includes:
  - `owner`: team responsible.
  - `contact`: escalation channel.
  - `defaultRetention`: 30 days history for harvesters, 7 days for experiments.
  - `encryption`: KMS key alias referenced in ops runbook.
- Automation validates namespace existence before deployment; missing namespace fails CI.

## Task Queues
- `meta-ts`: TypeScript workers handling API orchestration, GraphQL triggers, and lightweight transformations.
- `meta-py`: Python workers executing harvesters, data enrichment, and ML tasks.
- Workflows declare required queues in specs; activities must not cross language boundaries without contract wrappers.

## Workflow Families

### `metadataCollectionWorkflow`
- **Purpose**: synchronize external endpoints (APIs, documentation sources) into normalized catalog items.
- **Key Requirements**
  1. Fetch cursor/checkpoint from the semantic KV store using tenant/project-prefixed keys and semantics (`purpose=checkpoint`).
  2. Run harvester activities on `meta-py`, normalization/persistence on `meta-ts`. Workers must declare directives per `Agent.md`.
  3. Update cursor via CAS. On conflict, transition to `WaitingCursorAdvance` and emit structured log `CursorAdvanceRequested`.
  4. Respect schedule controls (pause/resume/reschedule/trigger). Manual triggers require `manual_trigger_id` and appear in audit logs.
  5. Emit metrics: run duration, items processed, cursor lag, backoff attempt counts.

### `previewDatasetWorkflow`
- **Purpose**: serve dataset previews backed by metadata endpoints while honoring capability flags (`preview` capability).
- **Key Requirements**
  1. Activities run on `meta-ts` by default, but heavy connectors can delegate to `meta-py`.
  2. Every run logs start/completion with `directive=previewDatasetWorkflow`, `tenant_id`, `project_id`, `endpoint_id`.
  3. Enforce concurrency limits per endpoint to avoid resource exhaustion.
  4. If endpoint capability is missing, short-circuit with warning log and emit metric `preview_disabled_total`.

### Future Workflows (Backfills, Exports)
- Must reuse the same patterns: declare directive names, use KV for checkpoints/latches, and emit consistent logs/metrics.

## Schedule Controls
- **Pause**: sets schedule to `paused=true`, adds annotation in KV; workflows in `Pending` remain unscheduled.
- **Resume**: flips `paused=false`, writes audit log referencing authorization.
- **Reschedule**: updates cron expression; future runs use new cadence while existing runs finish.
- **Trigger**: manual invocation with `manual_trigger_id`; bypasses schedule but respects concurrency limits.

## Cursor & Advance Rules
- Cursor stored as deterministic JSON payload (e.g., OneDrive delta token, Git SHA).
- CAS conflicts instruct workflow to wait and retry with exponential backoff.
- When external source reports no new data, workflow records heartbeat but does not mutate cursor.
- Manual overrides require spec reference and create `CursorAdvanceRequested` event for audit.

## Backoff Policy
- Exponential backoff starting at 1 minute, doubling up to 1 hour for recoverable failures.
- Fatal errors (e.g., authorization revoked) push workflow to `Failed` state and require manual intervention.
- Backoff metadata stored in workflow memo for observability and support tooling, and surfaced via metrics/logs.

## Logging Expectations
- Emit logs per `log-taxonomy.md`:
  - `INFO` at schedule start (`directive=endpointSyncWorkflow`).
  - `INFO` for `CursorAdvanceRequested` with reason.
  - `WARN` on recoverable errors (network, rate limit) with future retry timestamp.
  - `ERROR` when workflow transitions to `Failed`.
  - `DEBUG` optional for pre/post payload hashes guarded by feature flag.
- Log fields include `workflow_id`, `run_id`, `tenant_id`, `project_id`, and `spec_id`.

## Metrics & Observability
- Metrics: run duration, item counts, cursor lag, backoff attempts.
- Alerts: failed runs > 3 within 24 hours per tenant triggers pager.
- Traces: each activity spans propagate correlation ID aligned with log taxonomy.

## Acceptance Criteria
- Workflows launch in environment-specific namespaces and respect task queue assignments.
- Manual pause/resume/reschedule/trigger operations update schedules and produce audit logs.
- Metadata ingestion workflows use the semantic KV store for cursors and follow the state diagram (including `WaitingCursorAdvance`).
- Preview workflows honor endpoint capabilities and emit the required metrics/logs.
- Backoff policy enforces upper bound of 1 hour for recoverable errors; fatal errors escalate.
- Logs contain required fields and align with taxonomy; missing fields fail ingestion tests.

## Open Questions
- Should `meta-ts` handle certain harvesters for latency reasons?
- Do we need dynamic namespace creation for tenant onboarding?
- How to expose cursor state to end users without leaking sensitive tokens?
