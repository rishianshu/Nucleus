# Acceptance Criteria

1) A code vector profile exists and enforces canonical metadata keys  
   - Type: unit  
   - Evidence:
     - Add tests that map a raw.code.file_chunk envelope to:
       - profileKind="code"
       - projectKey normalized to "{owner}/{repo}"
       - entityKind="code.file_chunk"
       - sourceFamily="github"
     - Verify missing tenantId/projectKey/profileKind rejects the record.

2) Index-run ingests raw.code.file_chunk artifacts from MinIO sink and upserts into pgvector idempotently  
   - Type: integration  
   - Evidence:
     - Seed MinIO sink dataset with JSONL.GZ containing chunks for 2 files * 3 chunks each.
     - Run StartIndexRun(profileId="code.github.v1", sourceSelector=dataset prefix).
     - Assert:
       - vector_documents row count == 6 after first run
       - running the same index run again does not increase count (upsert/dedupe)
       - updated_at changes if content_text changes (optional check).

3) Deterministic offline tests validate retrieval + filtering by canonical keys  
   - Type: integration  
   - Evidence:
     - Use DeterministicFakeEmbeddingProvider.
     - Query/search returns results filtered by:
       - tenantId
       - projectKey
       - profileKind="code"
     - Ensure query surface does not require external embedding services.

4) Hardening: oversized/malformed records do not corrupt the index  
   - Type: integration  
   - Evidence:
     - Include in dataset:
       - one chunk with payload.text > max limit (should be truncated or skipped deterministically)
       - one record missing projectKey (skipped with E_MISSING_CANONICAL_KEYS)
       - one record with invalid JSON line (counted as failure, run continues)
     - Run completes with status FAILED or SUCCEEDED_WITH_ERRORS (choose one; must be deterministic)
       and vector_documents contains only valid records.
