# Acceptance Criteria: Force MinIO Staging

## 1. Unit Tests
- Add a test case in `orchestration/manager_test.go` (if exists) or create one that calls `selectProvider` without MinIO params (and no env vars) -> MUST return error `E_STAGING_UNAVAILABLE`.
- Add a test case where MinIO is configured -> MUST return MinIO provider and NO error.

## 2. Integration Verification
- Run an ingestion operation (e.g. `github.issues`).
- Check the worker logs.
- **Expected**:
    - `manager.go` logs selecting `object.minio` provider.
    - `RunIngestionUnit` activity logs `providers [object.minio ...]`.
    - Downstream `IndexArtifact` activity succeeds (because it finds the object in MinIO).

## 3. Failure Scenario
- Stop MinIO (or set invalid config).
- Start ingestion.
- **Expected**: Ingestion FAILS immediately at "Planning" or "Running" stage with "staging unavailable" error. NOT falling back to memory.
