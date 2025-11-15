# Spec: Observability and SLOs

## Context & Goal
- Provide unified observability guidance covering logs, metrics, traces, and alerting for the Nucleus platform.
- Align with log taxonomy, ensure metrics capture operational health, and define performance budgets with SLO commitments.

## Logging
- Adopt the contract in `docs/contracts/log-taxonomy.md`.
- Required log events:
  - `INFO` when directives start, complete, or no-op.
  - `WARN` for partial success, retries, or external dependency degradation.
  - `ERROR` for failed operations requiring intervention.
  - `FATAL` for unrecoverable corruption or security incidents.
- Logs must include `tenant_id`, `project_id`, `agent`, `directive`, `spec_id`, `correlation_id`, and `request_id` where applicable.
- Redact secrets and personally identifiable information; violations trigger automated alerts.

## Metrics
- **Run metrics**: `workflow_runs_total` (labels: `directive`, `tenant_id`, `result`), `workflow_run_duration_seconds`.
- **Upsert metrics**: `entity_upserts_total`, `edge_upserts_total`, classified by `source_system` and `outcome` (`created`, `updated`, `unchanged`).
- **Failure metrics**: `workflow_failures_total`, `kv_conflicts_total`, `api_errors_total` (labels include `operation`, `status_code`).
- **Resource metrics**: `queue_depth`, `task_queue_latency`, `embedding_generation_duration`.
- Metrics exported via OpenTelemetry; scraped every 30 seconds in production.

## SLOs
| Service | Objective | Target | Window |
| --- | --- | --- | --- |
| GraphQL queries | p95 latency <= 300ms | 99% of requests | 30-day |
| Vector search | p95 latency <= 500ms | 99% of requests | 30-day |
| Workflow success | Successful runs / total runs >= 98% | 30-day |
| KV operations | p99 latency <= 200ms | 30-day |
| Logging pipeline | Delivery uptime >= 99.9% | 30-day |

- Breaches require post-incident review within 72 hours.
- SLOs tied to dashboards; error budgets tracked to inform feature release pace.

## Alert Triggers
- **Latency**: Alert when GraphQL p95 > 300ms for 15 minutes or vector search p95 > 500ms for 15 minutes.
- **Error rate**: Alert when workflow failure rate exceeds 5% over 30 minutes.
- **KV conflicts**: Alert when `kv_conflicts_total` increases > 10 per minute for 10 minutes.
- **Queue depth**: Alert if task queue depth > 100 for `meta-py` or `meta-ts` for 10 minutes.
- **Logging gaps**: Alert when log ingestion rate drops below baseline by 50% for 5 minutes.
- Alerts notify on-call channel and create incident ticket automatically.

## Tracing
- Every workflow run propagates correlation ID to activities and API calls.
- Trace spans include attributes: `tenant_id`, `project_id`, `directive`, `spec_id`, `workflow_id`, `task_queue`.
- Retain traces for 7 days; high-cardinality sampling suppressed unless debugging mode enabled.

## Dashboards
- Core dashboard per tenant showing throughput, errors, latency percentiles, queue depth, and backlog age.
- SLO dashboard with burn rate indicators and historical performance.
- Security dashboard for access anomalies (in collaboration with security spec).

## Acceptance Criteria
- Logs from all services conform to taxonomy and include required fields.
- Metrics emitted with correct labels and scraped successfully in staging.
- SLOs recorded in operations runbook with clear owners.
- Alerts tested in staging to ensure routing works and noise thresholds are acceptable.
- On-call playbooks reference metrics, dashboards, and log searches.

## Open Questions
- Should we adopt dynamic sampling for logs at DEBUG level?
- Do we need tenant-specific alert overrides for large tenants?
- How to incorporate user-facing latency into SLOs beyond GraphQL?
