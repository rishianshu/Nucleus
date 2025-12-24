# Acceptance Criteria: Checkpoint Tightening

## 1. Input Validation
- [ ] **SinkID Enforcement**: Calling `startIngestionRun` (or `ingestion.RunIngestionUnit`) without a `sinkId` must return a clear error.
- [ ] **StagingProviderID**: Verify `stagingProviderId` is validated or correctly defaulted.

## 2. Checkpoint Structure
- [ ] **Flat Cursor**: After an ingestion run (full or incremental), the persisted checkpoint in the KV store must NOT contain nested cursors (e.g., `cursor: { cursor: { ... } }`).
- [ ] **Metadata Preservation**: Key metadata (watermarks, runIds) must be preserved at the top level of the checkpoint map.

## 3. Incremental Behavior
- [ ] **incremental-ingestion**:
    1. Run 1: Ingest complete dataset (e.g., 50 records).
    2. Run 2: Ingest with same checkpoint. Result should be 0 records (or only new ones).
    3. Verify `lastRunAt` and `recordCount` in the checkpoint are updated.

## 4. Storage Backend
- [ ] **KV Client Usage**: Verify that checkpoints are saved using `kv_client` (gRPC) and not the local file-based store (`kv-store.json`), unless `kv_client` falls back to it (ensure intention is verified).
