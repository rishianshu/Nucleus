# Holistic Metadata Platform

Metadata is a first-class subsystem shared by ingestion, reconciliation, and
future observability tools. Each producer emits structured facts about its work,
and consumers rely on the same repository to answer operational questions
without rebuilding context from raw logs. This document describes a shared
architecture that works today (embedded with the ingestion service) and can be
peeled out into a standalone metadata service later.

## Goals

- Provide a consistent schema and API for emitting run-time facts from multiple
  products (ingestion, recon, orchestration, quality).
- Capture enough attributes (time window, filters, lineage identifiers) so
  consumers can join records across systems.
- Serve low-latency reads for pipeline decisions while also retaining history
  for trend analysis (e.g., recon variability baselines).
- Remain deployable in-process today, with clear seams for future extraction
  into a managed service.

## Domain model

The core abstractions now live under the `runtime_core` package (with legacy
shims removed) and should remain the single
source of truth:

- **MetadataTarget** – captures the physical artifact (`source_id`, `schema`,
  `table`, optional `extras`) that the record describes.
- **MetadataContext** – accompanies every interaction and carries execution
  identifiers such as `job_id`, `run_id`, namespace, and arbitrary extras (e.g.,
  orchestrator name, triggering schedule).
- **MetadataRecord** – persisted fact produced by a subsystem. Records contain
  the `target`, canonical `kind` (e.g., `ingestion_volume`, `recon_result`,
  `schema_snapshot`), structured `payload`, `produced_at` timestamp, and the
  emitting `producer_id`. Optional fields `version`, `quality`, and `extras`
  carry additional annotations.

Run-scoped details—window start/end, filter expressions, linked ingestion run
IDs, calculated thresholds—belong inside the record `payload` or `extras`
depending on whether consumers need to query them frequently. Consistency is
achieved by documenting a JSON schema per `kind` (see “Immediate roadmap”) and
by using shared helper builders so ingestion, recon, and metadata collectors
serialize common attributes the same way.

## Producer contracts

All systems participate as `MetadataProducer` implementations executed by the
`MetadataProducerRunner`. Producers receive a `MetadataRequest` that bundles the
target artifact and the `MetadataContext`, and they respond with one or more
`MetadataRecord` instances.

- **Ingestion pipeline** – after each source → sink load, emit
  `ingestion_volume` (row/byte counts, slice filter, watermark) and optionally
  `ingestion_runtime` (duration, retries) records. Guardrail actions or
  deduplication summaries belong in the record `extras`.
- **Reconciliation** – emit `recon_result` records for every check, capturing
  outcome, observed metric, configured thresholds, variability parameters, and
  references to the ingestion run IDs that supplied the baseline. Drill-down
  scopes (`["year_month","day"]`, etc.) should be persisted so downstream
  analytics understand escalation behavior.
- **Metadata collectors** – continue to publish `schema_snapshot`,
  `statistics_snapshot`, and `catalog_diff` records. These become the
  authoritative catalog data that ingestion and recon consume.

Each producer must include a stable `producer_id` (e.g., `ingestion.v1`) and
populate the `MetadataContext` with environment identifiers (cluster, workspace,
tenant) so audit trails remain intact once the platform becomes multi-tenant.

## Repository abstractions

The emitter interface delegates to a repository implementation responsible for
durable storage. Today the default repository can stay file-backed (JSON/Parquet
under `metadata_service.cache`). To prepare for a dedicated service:

- Define `MetadataRepository` with the existing methods (`store`, `bulk_store`,
  `latest`, `history`, `query`) and route every producer through it via the
  cache manager.
- Provide two implementations:
  1. **Embedded** – writes to disk and keeps an in-memory index for fast lookups
     inside the same process (current behavior).
  2. **Remote client** – issues HTTP/gRPC requests to a metadata service. The
     client preserves the same signature, so emitters do not change when the
     backend is swapped.
- Maintain an append-only log (`metadata.log`) alongside structured files so
  downstream systems can tail updates without scanning the entire store.

## Consumer patterns

Consumers access metadata through read-only helpers:

- **Ingestion planner** – fetch the latest `schema_snapshot` and
  `ingestion_volume` to determine column precision, expected size, and change
  rates before scheduling work.
- **Reconciliation variability** – compute moving averages and tolerance bands
  by querying `ingestion_volume` (for baseline metrics) and prior `recon_result`
  records. The variability logic described in `docs/reconciliation.md` depends
  on these APIs rather than bespoke storage.
- **Operational dashboards** – aggregate over `recon_result` to show pass/fail
  trends, highlight tables with repeated timeouts, and correlate with ingestion
  volumes.
- **Orchestrator** – check metadata before launching jobs (e.g., block ingestion
  if schema diff highlights breaking changes), and record schedule metadata such
  as frequency or SLA adherence.

Query helpers should support both point lookups (`latest(target, kind="recon_result")`)
and windowed scans via `history`/`query` (e.g., filter `extras.window_start` /
`extras.window_end` when computing variability).

## Storage layout

When embedded, store records under:

```
metadata/
  index.json            # catalog of artifacts and latest versions
  log/                  # append-only JSONL stream for fast tailing
  records/
    ingestion_volume/
      itcftth.srv_cfsver_ct_main/
        2024-01-10T05:00:00Z_run-123.json
    recon_result/
      itcftth.srv_cfsver_ct_main/
        2024-01-10T06:00:00Z_run-456.json
```

The same logical paths transfer to remote storage (object store, relational
database, or document DB) with adapters translating the layout.

Retention is controlled per `kind`:

- High-frequency metrics (ingestion volume) keep a rolling window (e.g., 90
  days) plus optional archival.
- Low-frequency snapshots (schema) retain full history for audit.

A nightly compactor job condenses historical JSON entries into Parquet or
database tables for efficient analytics while keeping the append-only log for
real-time consumers.

## History initialization

Before variability logic or cross-system dashboards rely on the metadata
platform, seed it with historical facts gathered outside the new pipeline.

1. **Inventory raw sources** – reuse existing artifacts such as ingestion
   progress logs (`ingestion_runtime/tools/progress_cli.py` reads their JSONL format),
   slice manifests, guardrail reports, recon JSON outputs, and catalog snapshots
   produced by the current collectors.
2. **Normalize into metadata records** – write a one-time batch job that parses
   those sources and emits `MetadataRecord` instances per `kind`, populating
   `MetadataContext.run_id` / `job_id` when available. Encode logical windows,
   filters, and run lineage inside the `payload` or `extras` exactly as the live
   producers will.
3. **Deduplicate and merge** – when multiple raw events describe the same run,
   collapse them into a single record (e.g., sum slice-level counts into an
   `ingestion_volume` total). Retain raw provenance in `extras.original_source`
   for audit.
4. **Bulk store** – use `MetadataRepository.bulk_store` so backfilled data flows
   through the same validation and indexing paths as real-time emits.
5. **Validate baselines** – run sampling queries to ensure reconstructed counts
   and timestamps match existing dashboards; flag tables lacking history so
   variability logic can fall back to static tolerances initially.

Keep the backfill job in source control and re-run it whenever new raw sources
are discovered, but treat the process as maintenance rather than part of the
steady-state ingestion.

## Event-driven integration

To decouple producers from the repository, optionally emit metadata on an
internal bus (Kafka, Pub/Sub, or local queue) before persistence:

1. Producer creates a `MetadataRecord`.
2. Record is published to `metadata.events`.
3. Repository subscriber writes the record to storage and updates materialized
   views (e.g., latest index).
4. Additional subscribers trigger alerts (schema drift, repeated recon failures)
   or propagate metrics to monitoring systems.

The bus abstraction is optional today (in-process queue), but designing for it
ensures smooth migration to a distributed service.

## Separation path

When metadata graduates to an independent service:

- Run the repository and indexers as a standalone application with its own
  persistence layer (SQL database or scalable document store).
- Expose a service API (`POST /records`, `GET /records/latest`, etc.) that
  mirrors the repository interface.
- Deploy sidecar or library clients within ingestion and recon that batch emits
  and retry on network issues.
- Introduce schema governance so new `kind` definitions are registered before
  use; provide a central catalog of schemas with versioning.
- Implement authentication/authorization (service tokens) to control read/write
  scopes once multiple teams interact with the metadata platform.
- Offer a lightweight SDK (`packages/metadata-sdk`) that wraps the gateway with
  CDM-style models so external services can emit or query metadata without
  depending on runtime internals. See `docs/metadata-sdk.md` for usage patterns.
- Runtime helpers now live in `packages/metadata-service` so ingestion/recon
  depend on a standalone metadata package rather than internal modules.

Throughout the migration, the existing in-process path remains functional by
configuring the emitter with the embedded repository. Switching to the remote
service is a matter of selecting the client implementation.

## Immediate roadmap

1. **Standardize payload schemas** – document JSON schemas for
   `ingestion_volume` and `recon_result`, including required fields for
   variability calculations (counts, time windows, filters).
2. **Unify producers** – refactor ingestion and recon code to use the shared
   `MetadataProducer` interface instead of writing ad-hoc files.
3. **Backfill history** – migrate existing cached metadata into the new layout
   to unlock moving averages and trend analysis.
4. **Expose read helpers** – add client utilities for common queries
   (`latest`, `history`, lineage lookups) so feature teams can adopt the platform
   quickly.
5. **Service extraction prep** – define the remote repository contract and add a
   feature flag that swaps implementations without touching emitters.

This approach keeps metadata flexible enough for current embedded usage while
establishing the contracts needed to isolate it as a dedicated platform.
