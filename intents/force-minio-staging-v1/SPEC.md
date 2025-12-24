# Specification: Force MinIO Staging

## 1. Modify Manager Provider Selection

**File**: `platform/ucl-core/internal/orchestration/manager.go`

Update `selectProvider` method:
1.  **Force Preference**: Ignore `params["staging_provider"]` and overwrite it to `staging.ProviderMinIO` ("object.minio").
2.  **Remove Fallback**:
    *   Do NOT register `NewMemoryProvider` or `NewObjectStoreProvider` in the local registry used for selection.
    *   ONLY register the MinIO provider.
3.  **Error Handling**:
    *   If MinIO provider cannot be built (missing env) or selected, return a hard error `E_STAGING_UNAVAILABLE`.
    *   Ensure the error message clearly states "MinIO staging is required".

## 2. Verify Downstream Impact

**File**: `platform/ucl-core/internal/orchestration/manager.go` (`runIngestion`)

- Verify that when `executeSlice` is called, the `provider` passed in is indeed the MinIO provider.
- The `stageRef` returned by `provider.PutBatch` will contain the provider ID (e.g. `object.minio:...`).
- This reference is stored in `MaterializedArtifact` and passed to downstream activities.
- Since downstream activities resolve providers via `DefaultStagingRegistry()` (which we already fixed to include MinIO), they will be able to read the artifacts.

## 3. Configuration

Ensure `buildMinioProvider` correctly reads configuration from the manager's `params` or falls back to environment variables if needed (it already mimics `NewMinioStagingProviderFromEnv` logic partially, but we should double check).
**Note**: The current `buildMinioProvider` in `manager.go` reads from `params`. We might need to ensure it can also read from process ENV if params are missing, OR ensure that `nucleus-workers.sh` injects the necessary params into the ingestion request (though usually these come from the template or global config).
*Actually*, `manager.go` `selectProvider` builds a *new* registry for that operation. It uses `buildMinioProvider`. We should make sure `buildMinioProvider` is robust.
