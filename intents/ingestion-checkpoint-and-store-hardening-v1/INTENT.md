# Story: Checkpoint Tightening and Store Hardening

## Goal
Harden the ingestion checkpointing mechanism to prevent cursor nesting issues, enforce stricter start arguments, and adopt the unified KV store.

## Requirements

### 1. `startIngestionRun` Strictness
- **Mandatory `stagingProviderId`**: The activity must fail if this is missing. Defaulting to `object.minio` is acceptable if explicitly handled, but the field must be present/checked.
- **Mandatory `sinkId`**: The activity must require `sinkId`. This ensures the destination is explicit.

### 2. Checkpoint Cursor Flattening
- **Analysis**: The current checkpoint cursor behaves like a recursive wrapper (`cursor.cursor.cursor...`).
- **Fix**: Flatten the cursor structure. The new checkpoint should store the `cursor` as a direct pointer or a flat structure, rather than wrapping the previous full state recursively.

### 3. Checkpoint Usage Debugging
- **Issue**: It appears the last checkpoint is ignored, causing full ingestion on every run.
- **Task**: Verify and fix the logic that rehydrates the checkpoint state. Ensure `lastRunAt` and `cursor` are correctly read and respected by the ingestion logic.

### 4. Post-Ingestion Checkpoint Verification
- **Scope**: Checkpoint logic applies to both ingestion (source -> staging) and post-ingestion (staging -> index/CDM).
- **Task**: Verify that post-ingestion activities (e.g., `IndexArtifact`) also correctly respect and update checkpoints.

### 5. Unified KV Store Adoption
- **Current State**: Ingestion uses a file-backed store (likely `badger` or `leveldb` locally managed).
- **Target**: Switch to using `platform/store-core/pkg/kvstore`. This aligns ingestion with the newer, hardening KV store pattern used elsewhere (e.g., in `brain-worker`).

## Acceptance Criteria
- [ ] `startIngestionRun` fails if `sinkId` is missing.
- [ ] Checkpoints stored in KV do not show nested `cursor.cursor` structure after multiple runs.
- [ ] Subsequent runs perform incremental ingestion (processed count < full count) where appropriate.
- [ ] Ingestion worker uses `store-core/pkg/kvstore`.
