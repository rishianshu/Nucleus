# Plan
- Align code, doc, and work vectors on the shared `vector_index_entries` schema (docId + source metadata) and seed `code.github.v1`.
- Provide deterministic/in-memory embedding + vector stores for offline tests; keep Prisma store using docId/chunkId uniqueness.
- Implement code index-run to read MinIO JSONL.GZ datasets (ingestionRunId filter), normalize, embed, and upsert via the vector store.
- Cover AC1–AC4 with tests (normalization, idempotent indexing/search filters, hardening) and run `pnpm --filter @apps/metadata-api test:brain`; validate against pgvector/MinIO once infra is available.
