# Start Prompt

## Context
We are hardening the ingestion pipeline to ensure durability and cross-worker data availability. Currently, the ingestion manager can fall back to in-memory or local-disk staging if the preferred provider isn't available. This causes downstream workers (Brain Worker) to fail because they cannot access the local files of the UCL Worker.

## Task
Modify `platform/ucl-core/internal/orchestration/manager.go` to **STRICTLY ENFORCE** the use of MinIO for staging.

## Requirements
1.  **Modify `selectProvider`**:
    *   Ignore any `staging_provider` parameter that asks for non-MinIO.
    *   Always attempt to register ONLY the MinIO provider.
    *   Do NOT register `NewMemoryProvider` or `NewObjectStoreProvider`.
    *   If MinIO cannot be configured (missing env/params) or selected, return an error.

2.  **Modify `buildMinioProvider`** (if necessary):
    *   Ensure it can pick up `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, etc. from the environment variables (using `os.Getenv`) if they are missing from the request parameters. This ensures that even if the UI/CLI doesn't pass creds, the worker's env vars are used.

## References
- `platform/ucl-core/internal/orchestration/manager.go`
- `platform/ucl-core/pkg/orchestration/staging_registry.go` (for reference on how env vars are read)
