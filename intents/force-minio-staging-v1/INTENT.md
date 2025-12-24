# Force MinIO Staging for Ingestion

## Background
Currently, the ingestion manager selects a staging provider based on thresholds and preferences, potentially falling back to memory or local object storage. However, downstream consumers (like indexing and signal extraction) run in separate worker processes and require durable, shared storage to access the staged artifacts. Using memory or local disk staging (which is specific to the `ucl-worker` pod/process) causes downstream activities to fail with "object not found".

## Goal
Enforce that **ALL** ingestion jobs use the `object.minio` staging provider.
- Remove fallback to memory or local object-store for ingestion.
- Hard-fail the ingestion operation if MinIO is not available or not configured.
- Ensure the `StagingProviderID` in `RunIngestionUnit` is always `object.minio`.
