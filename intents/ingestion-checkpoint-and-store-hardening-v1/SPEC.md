# Feature: Checkpoint Tightening and Store Hardening

## Context
Ingestion checkpoints are currently suffering from recursive nesting and potential ignorance by the runner, leading to inefficient full re-ingestions. The storage backend is also legacy.

## Changes

### 1. Workflow/Activity Updates
- **File**: `platform/brain-core/internal/activities/ingestion.go` (or similar)
    - Modify `StartIngestionRun` signature or validation logic.
    - Ensure `stagingProviderId` and `sinkId` are validated.

### 2. Checkpoint Logic Refactor
- **File**: `platform/ucl-core/pkg/ingestion/checkpoint.go` (or wherever checkpoint logic lives)
    - Inspect `Checkpoint` struct and `Merge` logic.
    - Ensure `NewCheckpoint` = `OldCheckpoint + NewDelta`, not `NewCheckpoint = { Cursor: OldCheckpoint }`.

### 3. KV Store Migration
- **File**: `platform/brain-core/internal/worker/ingestion_worker.go`
    - Replace local `badger`/file store with `store-core/pkg/kvstore`.
    - Ensure `KV_STORE_PATH` or similar config points to the correct location/service.

## Verification Plan
1. **Run Ingestion Twice**:
    - Run 1: Full ingestion.
    - Run 2: Incremental (should process 0 or few records).
2. **Inspect State**:
    - Check KV store content (using extensive debugging or a temporary dumper).
    - Ensure no `cursor.cursor` pattern.
