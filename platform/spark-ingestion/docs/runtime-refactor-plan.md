# Runtime Refactor Plan

This plan covers the broader modularisation of the ingestion, reconciliation,
and metadata runtimes. Metadata is the first subsystem we tackle, but each phase
lays groundwork for the rest of the platform so we avoid rework. Complete the
phases in order and ship guardrails (tests, parity checks) at every step.

## Phase 0 – Discovery & inventory

- Catalogue current shared components (endpoints, execution tools, state,
  events) and document ownership.
- Identify tight coupling between ingestion/recon/metadata to inform boundaries.
- Decide on workspace tooling (Poetry/Hatch today; evaluate Pants/Bazel for
  long-term polyglot needs).
- Current inventory:
  - `ingestion_runtime/common.py` – run identifiers, logging helpers, ingestion column utilities.
  - `ingestion_runtime/events` – emitter, structured log subscribers, notifier wiring used by multiple runtimes.
  - `ingestion_runtime/endpoints` – shared factory and base classes for sources/sinks across ingestion and recon.
  - `ingestion_runtime/planning` – adaptive planner, probes, and registry consumed by ingestion (and targeted for recon reuse).
  - `ingestion_runtime/state.py` + `ingestion_runtime/staging.py` – state store implementations and buffered flushing shared by orchestration.
  - `ingestion_runtime/metadata` – collectors, cache, runtime accessors leveraged during ingestion schema validation.
  - `ingestion_runtime/tools` + `ingestion_runtime/orchestration` – Spark execution tool abstractions and orchestration helpers invoked by both ingestion and recon CLIs.
- Notable coupling hotspots:
  - Ingestion strategies import `metadata.runtime.MetadataAccess` directly for schema validation.
  - Reconciliation currently reads ingestion history from JSON outputs rather than a shared gateway.
  - Orchestrator helpers construct state stores and emitters tightly bound to ingestion assumptions (e.g., SCD1-specific logic).

## Phase 1 – Shared core & endpoint service

- Define an in-process gateway that fronts all metadata operations (`emit`,
  `emit_many`, `latest`, `history`, `query`).
- Extract reusable schemas, event models, metadata builders, endpoint contracts,
  and config utilities into shared packages consumed by ingestion, recon, and
  metadata.
- Refactor existing code to call the shared interfaces rather than touching
  repositories/caches directly.
- Add contract tests ensuring ingestion, reconciliation, and collectors behave
  the same with the embedded repository.
- Current workspace layout:
  - `packages/core` (imported as `ingestion_models`) – metadata models, schema
    drift helpers, CDM types.
  - `packages/runtime-common` (imported as `endpoint_service`) – endpoint
    contracts, metadata subsystems, tools, and shared IO/helpers.
  - `packages/ingestion-runtime` – orchestration, planners, strategies; depends
    on the shared models/endpoints.
  - `packages/metadata-service` – embedded metadata runtime helpers and
    collectors; consumes the shared packages.

## Phase 2 – Metadata alignment

- Run catalog harvesting through the shared endpoint interfaces so schema
  snapshots, statistics, and diffs flow through the common API.
- Update schema drift validators and guardrails to consume shared lookups
  instead of reading cache files directly.
- Backfill historical metadata through the shared repository path and validate
  parity with the current cache.
- Status: metadata collectors emit via `metadata-service` using shared models;
  legacy gateway/SDK packages have been removed in favor of the shared modules.

## Phase 3 – Ingestion integration

- Teach ingestion to emit `ingestion_volume` and `ingestion_runtime` records
  through the gateway alongside current structured logs.
- Guard with a feature flag and run parity comparisons before deleting legacy
  outputs.
- Move ingestion’s schema validation, state writes, and metadata reads onto the
  shared core package to reduce duplicate code.

## Phase 4 – Reconciliation integration

- Switch reconciliation to read baselines from the gateway (`ingestion_volume`)
  and emit `recon_result` records.
- Keep JSON summaries until dashboards confirm parity, then deprecate the old
  path.
- Align recon check execution with shared core primitives (endpoints, planners)
  to ensure new engines reuse the same interfaces.

## Phase 5 – Orchestration & event transport

- Introduce an asynchronous transport (local queue/outbox or Kafka topic)
  between producers and the repository while keeping the embedded backend.
- Verify backpressure and retry semantics; ensure replay keeps records
  idempotent.
- Refactor the orchestration layer to consume shared core helpers (state,
  emitters, heartbeat) and prepare for multiple runtimes (ingestion, recon,
  metadata collection).

## Phase 6 – Service extraction & packaging

- Deploy an optional standalone metadata service (HTTP/gRPC) that implements the
  gateway contract.
- Swap the repository client from embedded to remote in each subsystem; keep the
  embedded path for local development and fallbacks.
- Finalise package boundaries (`ingestion_models`, `endpoint_service`,
  `ingestion-runtime`, optional service impl) and align dependency direction.
- Clean up feature flags and remove deprecated code paths once production runs
  rely solely on the new architecture.
- Add operational runbooks (deployment, scaling, alerting, replay procedures)
  covering both embedded and service modes.

## Near-term execution checklist

1. ✅ Create `packages/` scaffolding with placeholder `pyproject.toml` files for
   `ingestion-models` and `runtime-common` (`endpoint_service`);
   wire them into the existing virtualenv via editable installs.
2. ✅ Introduce smoke tests verifying the gateway API against the embedded
   repository before moving any producers.
3. ✅ Move purely declarative artifacts (data classes, enums) from
   `ingestion_runtime/metadata/core/interfaces.py` into `runtime-core`, leaving
   re-export shims to avoid breakage.
4. ✅ Update runtime imports to reference the shared `ingestion_models` module
   and ensure unit tests still pass.
5. ✅ Move metadata runtime/collector/cache logic into the standalone
   `metadata-service` package and delete the legacy shims.
6. ✅ Relocate schema drift validators and precision guardrails into
   `metadata-service` and convert legacy modules to thin re-export shims.
7. Proceed to Phase 2 tasks once gateway-backed emissions and schema lookups are
   routed exclusively through the SDK/services.
