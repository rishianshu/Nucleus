# Metadata Backfill Plan

This guide describes how we will migrate historical ingestion metrics into the
metadata gateway so reconciliation variability can use a unified store. Treat
the process as a one-time maintenance job, but keep scripts repeatable for
future replays.

## Sources of truth

- **Structured ingestion logs** – JSONL events captured via `StructuredLogSubscriber`
  (guarded by `progress_cli`). These contain per-table row counts, durations,
  and error details.
- **State database (SingleStore)** – authoritative watermarks and event history
  (`eventsTable`, `watermarksTable`) that confirm slice counts and finalization
  timestamps.
- **Existing metadata cache** – latest catalog snapshots written by the
  collector; use as a reference when verifying target namespace/entity names.
- **Reconciliation outputs** – current JSON summaries to cross-check table
  identifiers when stitching ingestion and recon history later.

## Backfill workflow

1. **Extract raw events**
   - Dump the state tables and structured log archives for the backfill period.
   - Normalize timestamps to UTC and standardize table identifiers
     (`schema.table` lowercase) to avoid duplication.
2. **Reconstruct ingestion_volume records**
   - For each successful ingestion event, compute payloads matching the new
     `ingestion_volume` schema (`rows`, `mode`, `load_date`, `run_id`).
   - Use watermarks to recover incremental metadata (new watermark, last loaded
     date) when available.
   - Derive target namespace/entity using the same `safe_upper` rules as live
     emissions.
3. **Reconstruct ingestion_runtime records**
   - Aggregate start/end timestamps per table to calculate runtime durations.
   - Flag failures with the captured error message and stack hash so monitoring
     can trend retries.
4. **Emit through the gateway**
   - Run an offline script that instantiates the metadata gateway with the
     cache-backed repository and streams reconstructed `MetadataRecord`s via
     `emit_many`.
   - Enable dry-run mode to validate payloads before writing.
5. **Validation**
   - Compare per-table counts against the state database to ensure no records
     were skipped.
   - Spot check variability calculations (moving averages) using the backfilled
     data and confirm parity with the previous JSON outputs.
   - Retain a manifest of emitted records (table, kind, version) for audit.

## Operational notes

- Perform the backfill window-by-window (e.g., monthly) to avoid overwhelming
  the metadata cache.
- Pause automated variability computations while backfill runs to prevent mixed
  baselines; resume once each window is complete.
- Store the scripts under `scripts/metadata_backfill/` and document invocation
  examples so the process can be repeated when onboarding legacy tables.
