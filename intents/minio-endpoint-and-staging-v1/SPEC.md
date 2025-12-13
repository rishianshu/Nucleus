# SPEC — MinIO Endpoint and Staging Provider v1

## Problem

We need a concrete object-store backend to make ingestion scalable:

- Temporal payloads must not carry large record arrays.
- Source writes to staging and returns stageRef handles.
- Sink reads from staging and persists.

MinIO provides:
1) staging provider for large ingestion runs,
2) a real sink endpoint for raw/CDM landing artifacts,
3) the base needed for GitHub code + doc ingestion + later indexing.

## Interfaces / Contracts

## A) MinIO Endpoint Template Descriptor

Template family: `object.minio`

Descriptor fields (JSON, high-level):
- connection:
  - endpointUrl (required) e.g. `http://localhost:9000`
  - region (optional)
  - useSSL (optional)
- auth:
  - accessKeyId (required)
  - secretAccessKey (required)
- defaults:
  - bucket (optional; if provided, validate it exists)
  - basePrefix (optional; used for sink destinations)
- capabilities advertised:
  - endpoint.test_connection
  - metadata.plan, metadata.run (optional, minimal)
  - preview.run (optional)
  - staging.provider.object_store
  - sink.write

Validation rules:
- endpointUrl must be URL-like.
- accessKeyId/secretAccessKey must be non-empty.
- if bucket provided: must exist and be listable/writable depending on chosen mode.

Auth modes:
- service only (no delegated auth in this slug).

## B) gRPC capability + operations

UCL must support:
- ProbeCapabilities(templateId|endpointId) includes the above capabilities.
- StartOperation/GetOperation (existing):
  - allow operation kind PREVIEW_RUN and (optionally) METADATA_RUN for MinIO.
  - ingestion is handled by generic ingestion workflow; MinIO provides staging + sink.

## C) ObjectStoreStagingProvider (MinIO-backed)

Stage handle rules:
- stageRef is opaque string:
  - includes tenantId + runId + stageId (or derivable prefix)
- Object layout (example):
  - `staging/{tenantId}/{runId}/{sliceId}/{batchSeq}.jsonl.gz`
  - plus `staging/{tenantId}/{runId}/manifest.json` (optional)

Batch format:
- newline-delimited JSON (JSONL) of record envelopes
- gzip compressed by default for size
- each record is the standard envelope:
  - recordKind (raw|cdm)
  - entityKind
  - tenantId, projectKey
  - source { endpointId, sourceFamily, sourceId, url?, externalId? }
  - payload JSON
  - observedAt timestamp

Provider operations:
- PutBatch(stageRef/scope, sliceId, batchSeq, records[]) -> {batchRef, bytesWritten, recordCount}
- ListBatches(stageRef, sliceId) -> batchRefs
- GetBatch(stageRef, batchRef) -> stream/records
- FinalizeStage(stageRef) -> ok

Hard limits:
- memory provider exists elsewhere; MinIO provider must handle large batches.

## D) MinIO SinkEndpoint

Sink writes are persistent artifacts:
- Destination layout (example):
  - `sink/{tenantId}/{sinkEndpointId}/{datasetSlug}/dt={YYYY-MM-DD}/run={runId}/part-{n}.jsonl.gz`
- datasetSlug derived from:
  - `recordKind` + `entityKind` (and optionally sourceFamily)
  - e.g. `raw.work.item`, `cdm.work.item`, `raw.doc.item`

Sink responsibilities:
1) Read staged batches from stageRef.
2) Write to destination objects in MinIO.
3) Emit destination dataset artifacts to metadata plane so catalog can display them:
   - create/update a dataset identity entry with url `minio://bucket/prefix/...`
   - attach basic schema (fields) where known (at least envelope fields)
4) Optional: trigger metadata collection for the sink endpoint (if supported) to surface datasets.

## E) Error model

Required errors:
- E_ENDPOINT_UNREACHABLE (retryable=true)
- E_AUTH_INVALID (retryable=false)
- E_BUCKET_NOT_FOUND (retryable=false unless bucket config changes)
- E_PERMISSION_DENIED (retryable=false)
- E_TIMEOUT (retryable=true)
- E_STAGING_WRITE_FAILED (retryable=true)
- E_SINK_WRITE_FAILED (retryable=true)

All include:
- code, message, retryable, detailsJson.

## Data & State

- Staging objects: ephemeral, run-scoped.
- Sink objects: persistent, discoverable in catalog.
- No UI required in this slug; catalog artifacts are sufficient proof.

## Constraints

- Must work in dev/CI via:
  - a MinIO container in stack, OR
  - a deterministic fake object store used in tests.
- No false-success:
  - SUCCEEDED only if destination objects exist + manifest/count checks pass.

## Acceptance Mapping

- AC1 → template + test_connection tests
- AC2 → staging provider tests (stageRef-only, object layout)
- AC3 → sink writes + catalog artifacts test
- AC4 → negative hardening tests
