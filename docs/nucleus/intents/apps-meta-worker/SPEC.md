# Spec: Meta Worker Application

## Context & Goal
- Define the behaviour of the worker application responsible for executing Temporal activities and workflows supporting ingestion, enrichment, and orchestration.
- Ensure deterministic execution using idempotent persistence, structured retries, and log taxonomy adherence.
- Provide workflow steps and error handling classes shared across worker implementations.

## Task Queues
- Primary queues: `meta-py` for Python-based harvesters/enrichments, `meta-ts` for TypeScript orchestration helpers.
- Workers register with heartbeat intervals defined by directive (default 30 seconds).
- Queue configuration stored in spec metadata to validate new directives; CI fails if directive queue undefined.

## Workflow Steps (Generic Directive)
1. **Acquire Context**: Load directive spec, tenant/project claims, and request metadata.
2. **Resolve Cursor**: Read KV checkpoint using CAS; if conflict, emit WARN and retry per policy.
3. **Fetch Source Data**: Call external APIs or connectors respecting rate limits and page sizes.
4. **Transform & Normalize**: Convert payloads into normalized items or domain-specific descriptors.
5. **Persist & Emit**: Write to Postgres via deterministic upsert, publish events to outbox if required.
6. **Advance Cursor**: Persist new checkpoint via KV CAS; handle failures according to advance policy.
7. **Finalize**: Emit success logs, metrics, and update workflow status.

## Error Classes
- `RetryableTransient`: network issues, rate limits, temporary source unavailability.
- `Conflict`: KV CAS conflicts or database contention; requires retry with backoff.
- `ValidationFailure`: malformed data or schema mismatch; escalates to maintainers.
- `Fatal`: authorization revoked, spec missing, or corrupted state; workflow fails and awaits manual action.

## Heartbeats & Cancellation
- Activities send heartbeats every 30 seconds; long-running steps must checkpoint partial progress.
- Cancellation signals propagate from Temporal; workers must stop fetching new data and persist safe state.
- On cancellation, emit INFO log with `outcome=cancelled` and include last cursor saved.

## Page Sizes & Batching
- Default page size 100 items per fetch; directives may override between 50-500 depending on source limits.
- Batches persisted using chunked upserts; ensure each batch is idempotent via deterministic keys.
- Memory ceilings: keep in-process batch payload under 50 MB; otherwise stream to disk buffer or split batch.

## Retries & Backoff
- RetryableTransient -> exponential backoff starting 30 seconds, doubling to max 10 minutes.
- Conflict -> jittered backoff 5s, 10s, 20s, capped at 1 minute; escalate if more than five attempts.
- ValidationFailure -> no retry; workflow logs error and marks item for manual review.
- Fatal -> immediate failure; requires operator intervention and ADR update if systemic.

## Idempotent Persistence
- Upserts rely on primary keys derived from normalized contracts (entity ID, hash).
- Database writes use `ON CONFLICT DO UPDATE` semantics or stored procedures that respect version numbers.
- If hash unchanged, skip write and emit INFO log `outcome=unchanged`.
- KV updates include `requestId` and `expectedVersion`; conflicts trigger Conflict class.

## Advance Cursor Policy
- Only advance cursor after successful persistence and verification of batch counts.
- Cursor payload includes `source_pointer`, `processed_count`, `checksum`.
- On partial failures, do not advance; store progress in temporary KV key with suffix `/partial`.
- Manual overrides require spec reference and audit trail entry.

## Logging
- Follow log taxonomy; set `agent=meta-worker`, `directive=<name>`.
- Emit:
  - `INFO` at step boundaries `AcquireContext`, `ResolveCursor`, `Persist`, `Finalize`.
  - `WARN` on retries with `error_class`.
  - `ERROR` on ValidationFailure.
  - `FATAL` on unrecoverable conditions before exit.
- Include `workflow_id`, `run_id`, `tenant_id`, `project_id`, `cursor` snapshot.

## Metrics
- `worker_runs_total` by directive and outcome.
- `worker_batch_processed_total` with labels `directive`, `result` (`created`, `updated`, `unchanged`, `failed`).
- `worker_retry_attempts_total` per error class.
- `worker_cursor_lag_seconds` to track staleness.

## Acceptance Criteria
- Workflow steps executed in order with logs confirming each stage.
- Error handling triggers appropriate retries and logging per class.
- Cursor advance documented, with conflicts resolved via retry policy.
- Heartbeats and cancellation behave as expected; tests simulate cancellation mid-batch.
- Metrics emitted for dashboards and matched to observability spec.

## Open Questions
- Should we allow workers to dynamically adjust page size based on rate limit feedback?
- Do we need per-tenant concurrency controls?
- How to surface partial failure diagnostics to UI?*** End Patch
