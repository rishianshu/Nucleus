# Plan — brain-vector-index-foundation-v1

1. **Schema & seeds**
   - Add Prisma schema + migration for `vector_index_profiles` and `vector_index_entries` (pgvector), and seed initial profiles for work/doc.

2. **Stores**
   - Implement IndexProfileStore + VectorIndexStore backed by Prisma for listing profiles, upserting entries, and vector queries with metadata filters.

3. **Indexer**
   - Build NodeIndexer to fetch CDM work/doc content, call EmbeddingProvider, normalize metadata (tenant/project/profileKind), and persist entries.

4. **Search API**
   - Implement BrainVectorSearch to embed query text, apply filters, and return scored nodeId hits for a profile.

5. **Tests**
   - Add AC1–AC4 coverage with fake embeddings, seeded CDM data, and vector store assertions for metadata normalization and query filtering.
