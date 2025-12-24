# SPEC — Code Vector Profile and Indexing v1

## Problem

We have code chunks (raw.code.file_chunk) being produced and persisted (MinIO sink),
but Brain cannot search code until those chunks are embedded and stored in pgvector
with a consistent, source-independent metadata schema.

We must:
- define canonical vector metadata keys,
- define a “code” index profile,
- implement an index-run pipeline reading MinIO sink artifacts,
- store embeddings in pgvector with idempotent upserts.

## Interfaces / Contracts

### Canonical Vector Metadata Schema

Every indexed row MUST include:

- tenantId: string (required)
- projectKey: string (required)
  - normalized per profile/source; for GitHub = "{owner}/{repo}"
  - for Confluence docs: spaceKey maps to projectKey (later)
- profileKind: "work" | "doc" | "code" | string (required)
- entityKind: string (required)
  - for this slug: "code.file_chunk"
- sourceFamily: string (required)
  - for this slug: "github"
- sourceUrl: string | null
- sourceExternalId: string | null
  - e.g. "{repo}@{sha}:{path}#chunk={i}"
- observedAt: timestamp (optional but recommended)
- attributes: json (optional)
  - repoPath, sha, chunkIndex, language, etc.

Notes:
- We may duplicate original source keys (spaceKey, repoKey) inside attributes, but canonical keys must exist.

### Vector Index Storage (pgvector)

Table semantics (names illustrative):
- vector_documents
  - id (stable docId, primary key)
  - tenant_id
  - project_key
  - profile_kind
  - entity_kind
  - source_family
  - source_url
  - source_external_id
  - content_text (text, possibly truncated)
  - embedding (vector)
  - attributes (jsonb)
  - raw_payload (jsonb nullable) OR source_pointer (text nullable)
  - created_at, updated_at

Indexes:
- (tenant_id, project_key, profile_kind)
- (tenant_id, profile_kind)
- ivfflat/hnsw index on embedding (depending on existing choice)

### Code Vector Profile

ProfileId: "code.github.v1"

Inputs:
- records from MinIO sink dataset: raw.code.file_chunk

Mapping:
- content_text = payload.text (trim, enforce max size, e.g. 20k chars)
- tenantId/projectKey/sourceFamily/entityKind = from envelope + normalization
- docId (stable) derived from canonical identifiers:
  - docId = "code:github:{tenantId}:{projectKey}:{path}:{sha}:{chunkIndex}"
- sourceUrl:
  - from envelope.source.url if present
- sourceExternalId:
  - from envelope.source.externalId or computed

Storage of raw:
- Prefer storing a bounded raw_payload subset:
  - {repo, path, sha, chunkIndex} plus minimal metadata
- Additionally store source_pointer:
  - minio object path or (bucket,prefix,objectKey)

### Index Run API / Workflow

Expose:
- StartIndexRun(profileId, sourceSelector, options) -> runId
- GetIndexRun(runId) -> status/progress/errors

sourceSelector:
- ingestionRunId (preferred) OR
- sinkEndpointId + datasetSlug + time range/prefix

Execution:
1) enumerate objects for the selected dataset
2) stream/parse JSONL.GZ envelopes
3) validate canonical keys (normalize projectKey)
4) embed content_text via EmbeddingProvider
5) upsert into pgvector table by docId
6) emit progress counters: objectsScanned, recordsIndexed, recordsSkipped, failures

### Embedding Provider

Interface:
- Embed(text[]) -> vectors[]

CI requirement:
- Provide DeterministicFakeEmbeddingProvider (hash-based) used in tests.
- Production provider can be plugged later (OpenAI/local model).

### Error model

Errors must be structured:
- E_INVALID_RECORD (retryable=false)
- E_MISSING_CANONICAL_KEYS (retryable=false)
- E_SOURCE_READ_FAILED (retryable=true)
- E_VECTOR_DB_FAILED (retryable=true)
- E_EMBEDDING_FAILED (retryable=true/false depending)

## Data & State

- Index runs store progress + errors for debugging.
- Idempotency:
  - docId stable; upsert updates embedding/metadata if text changed.

## Constraints

- Offline tests (no network).
- Additive schema changes; do not break existing profiles.

## Acceptance Mapping

- AC1 → unit tests for profile mapping + metadata normalization
- AC2 → integration test indexing from MinIO artifacts into pgvector with upsert/dedupe
- AC3 → search/query tests filtering by tenantId/projectKey/profileKind using fake embeddings
- AC4 → negative tests for oversized payload/missing keys/partial failures
