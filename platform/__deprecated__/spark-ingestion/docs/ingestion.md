# Ingestion Runtime

Ingestion is orchestrated by `ingestion.py`, which defers all logic to
`ingestion_runtime` modules. The runtime drives Spark-based copy or merge jobs
against JDBC sources and Iceberg/HDFS sinks while emitting rich state and log
events for monitoring.

## Goals

- Run configurable batches across many tables without editing code.
- Support both full-refresh and incremental (SCD1) ingestion strategies.
- Persist operational state (events, watermarks) so jobs can resume safely.
- Reuse collected catalog metadata to validate schemas before writing.
- Produce structured telemetry for monitoring dashboards and CLI tooling.

## Execution overview

1. **CLI entry point** – `ingestion.py` simply calls `ingestion_runtime.run_cli()`.
   The CLI parses options such as `--only-tables`, `--reload`,
   `--maintenance-mode`, and `--dump-orchestration-plan`
   (`ingestion_runtime/orchestrator.py:92`).
2. **Configuration validation** – `validate_config` enforces required runtime,
   metadata, and table settings before any Spark work begins
   (`ingestion_runtime/orchestrator_helpers.py`).
3. **State + logging setup** – `main()` wires an event emitter, buffered state
   sink, heartbeat, and notifier subscribers. Events flow to the configured
   state backend via `StateEventSubscriber`
   (`ingestion_runtime/orchestrator.py:45-88`).
4. **Metadata prefetch** – `collect_metadata` builds metadata-capable source
   endpoints and snapshots their schemas when enabled; `build_metadata_access`
   prepares validators that ingestion strategies use for schema drift checks
   (`ingestion_runtime/metadata/runtime.py`).
5. **Table selection** – runtime filters configured tables per CLI arguments,
   marks reload requests, and preloads cached watermarks and day status
   (`BufferedState.preload`).
6. **Parallel execution** – `run_ingestion` dispatches tables to a thread pool
   capped by `runtime.max_parallel_tables`. Each worker calls `_ingest_one_table`
   with an execution context and table-specific configuration
   (`ingestion_runtime/ingestion/runtime.py:159-212`).
7. **Completion** – after all futures resolve, buffered state and outbox sinks
   flush, the heartbeat/notifier stop, and staging directories undergo TTL
   cleanup when enabled.

## Table lifecycle

Every table run goes through `_ingest_one_table`
(`ingestion_runtime/ingestion/runtime.py:16-156`):

- Sets a Spark job group via the execution tool so Spark UI and logs reflect
  table-specific work.
- Emits `table_start` events and structured tool progress payloads.
- Builds source/sink endpoints with metadata access and event emitter wiring.
- Obtains the default planner (registered `AdaptivePlanner`) and constructs a
  `PlannerRequest` that carries table config, slicing policy, and load date.
- Looks up the strategy by `mode` (`"full"` or `"scd1"`). Unsupported modes
  raise immediately.
- On success, captures duration/row counts in emitted events; failures record
  stack hashes for grouping before bubbling the exception to the orchestration
  layer.

`run_ingestion` tracks overall progress via the heartbeat subscriber and emits
`table_done` or `table_failed` log events as futures resolve.

## Ingestion strategies

### Full refresh (`FullRefreshStrategy`)

- Skips work when state already marks both raw and finalized phases complete for
  the day (`ingestion_runtime/strategies.py:200-236`).
- Reads the full source DataFrame, validates schema against cached metadata,
  and appends ingestion housekeeping columns via `with_ingest_cols`.
- Writes raw data with `sink_endpoint.write_raw` and records a raw phase
  state-event including row counts and storage location.
- Optionally calls `sink_endpoint.finalize_full`, controlled by
  `runtime.finalize_full_refresh`. Finalization events capture strategies and
  sink-specific metadata.
- Error paths mark the phase as failed while leaving state traces for replay.

### Incremental SCD1 (`Scd1Strategy`)

- Derives the effective watermark from state (or `initial_watermark`) and any
  configured lag seconds (`ingestion_runtime/strategies.py:404-456`).
- Invokes the planner to determine one or more ingestion slices. When row-count
  probes are available and slicing is enabled, `AdaptivePlanner` splits large
  ranges into manageable windows.
- Streams each slice via `source.read_slice`, validates the first batch’s schema,
  decorates the data with ingestion columns, and stages it with
  `sink_endpoint.stage_incremental_slice`.
- After staging completes, calls `sink_endpoint.commit_incremental` to merge or
  write slices into intermediate + raw outputs, then emits state marks for
  intermediate, raw, and watermark phases.
- Updates watermarks and last-loaded dates in the state store so subsequent runs
  advance correctly.

Supported modes are registered in `STRATEGY_REGISTRY`
(`ingestion_runtime/strategies.py:638-645`). Adding a new mode involves implementing
the `Strategy` protocol and registering it under a unique key.

## Planning & slicing

`AdaptivePlanner` is the default planner (`ingestion_runtime/planning/adaptive.py`):

- Queries endpoint capabilities to confirm incremental support and derive
  literal formats for watermarks.
- Optionally runs a `RowCountProbe` to estimate the rows between lower/upper
  bounds.
- Applies configuration-driven slicing (`runtime.scd1_slicing`) to split large
  windows by duration, row count, or evenly spaced epochs while honoring caps on
  partitions and slice targets.
- Emits planner metadata (current literal, estimated rows, probe results) that
  strategies attach to state events for debugging.

## Endpoints and execution tools

- `SparkTool.from_config` loads the Spark session with JDBC/connector jars and
  exposes helper methods for job group manipulation
  (`ingestion_runtime/orchestrator.py:162-187`).
- `EndpointFactory.build_endpoints` instantiates source and sink endpoints based
  on per-table config (dialect, filtering, partitioning). Endpoints declare
  incremental capabilities and optionally implement the metadata contract.
- Incremental sinks provide staging, commit, and watermark persistence APIs used
  by `Scd1Strategy`.

## Metadata integration

- `collect_metadata` produces catalog snapshots ahead of ingestion runs when
  endpoints support `MetadataCapableEndpoint`. Snapshots are cached under
  `metadata/` via `MetadataCacheManager`.
- `build_metadata_access` returns a repository, schema drift policy, and
  precision guardrail evaluator. Strategies use `ExecutionContext.validate_schema`
  to compare incoming DataFrames with stored snapshots, optionally extending
  missing columns when policy allows.
- Guardrail defaults and schema policies (e.g., `require_snapshot`,
  `allow_missing_columns`) are supplied through `cfg["metadata"]`.
- When `runtime.metadata_gateway.ingestion_metrics` / `ingestion_runtime` are
  enabled, successful and failed runs emit `ingestion_volume` and
  `ingestion_runtime` records through the metadata gateway in addition to the
  traditional state/log events.

## State & observability

- Buffered state combines an in-memory cache with durable SingleStore tables for
  events and watermarks. `BufferedState` preloads progress to reduce database
  lookups and flushes through `TimeAwareBufferedSink`
  (`ingestion_runtime/state.py:328-520`, `ingestion_runtime/staging.py:74-153`).
- Event emitter publishes ingestion lifecycle events to subscribers:
  - `StateEventSubscriber` writes to the state store.
  - `StructuredLogSubscriber` mirrors JSON lines to disk or HDFS outboxes for
    `progress_cli.py`.
  - `NotifierSubscriber` drives periodic job notifications.
- Heartbeat batches status updates (tables total/done/fail) and can expose Spark
  metrics; intervals are set with `--heartbeat-seconds`.
- `progress_cli.py` consumes structured logs to render live terminal dashboards
  or summarize repeated failures.

## CLI options & runtime knobs

- `--only-tables` filters the configured list by `schema.table`.
- `--load-date` overrides the effective partition date used in state events.
- `--reload` toggles `force_reload` on selected tables, resetting watermark
  progress for incremental runs.
- `--wm-lag-seconds` applies a global watermark lag when planners compute slices.
- `--maintenance-mode {dry-run,apply,rebuild-from-raw}` runs maintenance tasks
  instead of ingestion and prints JSON results.
- `--dump-orchestration-plan` outputs a deployment-ready plan for external
  schedulers without running Spark work.

Key `runtime` configuration keys (see `conf/*.json`):

- `raw_root`, `final_root`, `intermediate`: storage roots for landing areas.
- `max_parallel_tables`: controls thread-pool width.
- `staging.enabled` & `staging.ttl_hours`: staging directory management.
- `state.*`: state backend credentials (SingleStore today).
- `scd1_slicing`: adaptive slicing thresholds (target rows, max partitions).
- `logging`: structured log sink and whether to emit JSON.
- `metadata`: cache path, TTL, guardrail defaults, schema policy.

Per-table options include `mode`, `incremental_column`, `primary_keys`,
`incr_col_type`, `lag_seconds`, `source_filter`, partition specs, and merge
filters. Tables may also define reconciliation blocks reused by `recon.py`.

## Maintenance & cleanup

- `Staging.ttl_cleanup` removes aged incremental slice directories that have
  both `_SUCCESS` and `_LANDED` markers (`ingestion_runtime/staging.py:29-73`).
- Maintenance mode delegates to `ingestion_runtime/maintenance.run`, enabling tasks
  like mirror rebuilds or dry-run audits without performing ingestion.

## Failure handling & retries

- Each strategy wraps sink interactions in try/except blocks that emit failure
  state marks; exceptions propagate to the orchestrator so the run exits with a
  non-zero status.
- Watermark updates happen only after `commit_incremental` succeeds, ensuring
  that partial failures do not advance progress.
- Buffered state keeps prior events and watermarks cached, enabling safe reruns
  after fixing issues.

## Relationship to metadata platform

This spec documents current ingestion behavior. The shared metadata platform
(`docs/metadata-platform.md`) introduces a unified repository for run metrics.
Ingestion already consumes catalog snapshots through that interface; emitting
`ingestion_volume` records via the same platform is planned follow-up work.
