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

## Phase 1 – Shared core & metadata gateway

- Define an in-process gateway that fronts all metadata operations (`emit`,
  `emit_many`, `latest`, `history`, `query`).
- Extract reusable schemas, event models, metadata builders, endpoint contracts,
  and config utilities into a `core` module consumed by ingestion, recon, and
  metadata.
- Refactor existing code to call the gateway rather than touching repositories/
  caches directly.
- Add contract tests ensuring ingestion, reconciliation, and collectors behave
  the same with the embedded repository.
- Proposed workspace layout:
  - `packages/runtime-core` – logging primitives, event bus, endpoint interfaces,
    metadata models, shared config helpers.
  - `packages/metadata-gateway` – gateway façade + repository adapters
    (embedded + remote) depending only on `runtime-core`.
  - `packages/metadata-sdk` – thin SDK that wraps the gateway with CDM-style
    models and helpers for external systems.
  - `packages/ingestion-runtime` – orchestration, planners, strategies; depends
    on `runtime-core` and `metadata-gateway`.
  - `packages/recon-runtime` – reconciliation engine; depends on `runtime-core`
    and `metadata-gateway`.
  - `packages/metadata-collector` – catalog harvesting jobs; depends on
    `runtime-core`, `metadata-gateway`.
  - `services/metadata-api` (Phase 6) – optional HTTP/gRPC service backed by the
    gateway.

## Phase 2 – Metadata alignment

- Run catalog harvesting as a gateway producer so schema snapshots, statistics,
  and diffs flow through the shared API.
- Update schema drift validators and guardrails to consume gateway lookups
  instead of reading cache files directly.
- Backfill historical metadata through the gateway and validate parity with the
  current cache.
- Status: metadata collector now emits via the shared `MetadataGateway` and
  `MetadataAccess` consumes gateway-backed repositories for schema validation.
- Backfill approach and operational steps are captured in
  `docs/metadata-backfill-plan.md`; execute it once ingestion metrics finish
  emitting through the gateway.
- Exposed the `metadata-sdk` package so external services can participate using
  the same gateway contracts. Created a `metadata-service` package that hosts
  the runtime helpers under the standalone package so the ingestion runtime no
  extracting the implementation.

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
- Finalise package boundaries (`core`, `ingestion-runtime`, `recon-runtime`,
  `metadata-gateway`, optional service impl) and align dependency direction.
- Clean up feature flags and remove deprecated code paths once production runs
  rely solely on the new architecture.
- Add operational runbooks (deployment, scaling, alerting, replay procedures)
  covering both embedded and service modes.

## Near-term execution checklist

1. ✅ Create `packages/` scaffolding with placeholder `pyproject.toml` files for
   `runtime-core` and `metadata-gateway`; wire them into the existing virtualenv
   via editable installs.
2. ✅ Introduce smoke tests verifying the gateway API against the embedded
   repository before moving any producers.
3. ✅ Move purely declarative artifacts (data classes, enums) from
   `ingestion_runtime/metadata/core/interfaces.py` into `runtime-core`, leaving
   re-export shims to avoid breakage.
4. ✅ Update runtime imports to reference the shared `runtime_core` module and
   ensure unit tests still pass. `MetadataAccess` now provisions
   `MetadataGateway` + `MetadataSDK` instances.
5. ✅ Move metadata runtime/collector/cache logic into the standalone
   `metadata-service` package and delete the legacy shims.
6. ✅ Relocate schema drift validators and precision guardrails into
   `metadata-service` and convert legacy modules to thin re-export shims.
7. Proceed to Phase 2 tasks once gateway-backed emissions and schema lookups are
   routed exclusively through the SDK/services.
