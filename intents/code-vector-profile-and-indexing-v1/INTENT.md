title: Code Vector Profile and Indexing v1
slug: code-vector-profile-and-indexing-v1
type: feature
context: >
  UCL (Go) now provides GitHub code ingestion that emits index-ready records
  (raw.code.file_chunk) and MinIO provides staging + sink artifacts. Brain/Indexing
  needs a reliable, source-independent indexing contract so “docs from Confluence”
  and “docs from OneDrive” and “code from GitHub” can be searched uniformly.
  We use Postgres + pgvector as the embedding store.

why_now: >
  GitHub ingestion is only valuable if Workspace/Brain can retrieve code. We need
  a code vector profile, canonical metadata keys, and an index-run pipeline that
  can ingest raw.code.file_chunk artifacts into pgvector deterministically.

scope_in:
  - Define a canonical vector metadata schema (source-independent keys) and apply it to code chunks:
    - tenantId (implicit/required)
    - projectKey (normalized; for GitHub = owner/repo)
    - profileKind ("code")
    - sourceFamily ("github", future: "gitlab", etc.)
    - sourceUrl, sourceExternalId
    - entityKind (e.g., code.file_chunk)
    - optional: repoPath, sha, chunkIndex
  - Add a "code" vector indexing profile:
    - input records: raw.code.file_chunk (from MinIO sink artifacts)
    - text field: payload.text
    - stable docId semantics for upsert/dedupe
  - Add an index-run workflow/API (Brain/Index layer) to:
    - select a source dataset/run to index (by ingestionRunId or sink dataset prefix)
    - read chunk records (via MinIO sink object listing + streaming)
    - embed and upsert into pgvector table
  - Ensure offline/deterministic CI:
    - embedding provider interface + deterministic fake embedding in tests (no external calls)
  - Minimal “lineage-lite” fields:
    - store raw JSON payload (bounded) OR store source pointer to sink object path
    - store sourceUrl and external identifiers

scope_out:
  - No GraphRAG orchestration in this slug (separate).
  - No Workspace UI changes.
  - No clustering/communities in this slug.
  - No new connector work (GitHub already emits chunks; MinIO already sinks).

acceptance:
  1. A code vector profile exists and uses canonical metadata keys (tenantId, projectKey, profileKind=code, sourceFamily).
  2. Index-run can ingest raw.code.file_chunk artifacts from MinIO sink and upsert embeddings into pgvector without duplicates.
  3. Deterministic tests run offline using fake embeddings and validate retrieval/filtering by canonical keys.
  4. Hardening: indexing gracefully handles oversized raw payloads, missing fields, and partial failures without corrupting the index.

constraints:
  - pgvector + Postgres is the storage backend.
  - No external embedding API in CI; must use a deterministic fake in tests.
  - Schema changes must be additive where possible; avoid breaking existing doc/work indexing.

non_negotiables:
  - Canonical metadata keys must be source-independent (projectKey normalization is required).
  - Upsert must be idempotent (stable docId).
  - Fail-closed on missing tenantId/projectKey/profileKind.

refs:
  - intents/semantic-github-code-source-v1/*
  - intents/minio-endpoint-and-staging-v1/*
  - intents/brain-search-graphrag-api-v1/* (integration follows)
  - docs/meta/* (vector/index/brain contracts)

status: ready
