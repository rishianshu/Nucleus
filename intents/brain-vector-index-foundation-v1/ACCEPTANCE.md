# Acceptance Criteria

1) Index profiles can be defined, listed, and validated at runtime  
   - Type: unit|integration  
   - Evidence:  
     - A migration creates `vector_index_profiles` and seeds at least two profiles:
       "cdm.work.summary" and "cdm.doc.body".  
     - A test uses `IndexProfileStore.listProfiles()` and `getProfile(id)` to
       assert that:  
       - both profiles exist,  
       - each has the expected nodeType, profileKind, and embeddingModel.  
     - Attempting to resolve a non-existent profileId yields `null` or a typed
       error.  
     - Suggested path: `apps/metadata-api/src/brain/indexProfiles.test.ts`.

2) Batch indexer can embed CDM work/doc nodes into the vector store  
   - Type: integration  
   - Evidence:  
     - A test seeds a small number of CDM work items and doc items (across at
       least one tenant/project) using existing CDM stores.  
     - The test configures a fake EmbeddingProvider that returns deterministic
       vectors.  
     - The test calls `NodeIndexer.indexNodesForProfile` for
       "cdm.work.summary" and "cdm.doc.body".  
     - It then queries the `vector_index_entries` table (or VectorIndexStore)
       and asserts that entries exist for each seeded entity with:  
       - correct nodeId, profileId, tenantId, project_key, profile_kind,  
       - embedding vectors of the expected dimension.  
     - Suggested path: `apps/metadata-api/src/brain/indexerWorkDoc.test.ts`.

3) Query API can run similarity search with metadata filters and return scored nodeIds  
   - Type: unit|integration  
   - Evidence:  
     - A test manually inserts or upserts a few `vector_index_entries` rows using
       the VectorIndexStore with known embeddings and metadata (e.g., different
       project_key values).  
     - Using a fake EmbeddingProvider to embed the query, the test calls
       `BrainVectorSearch.search` with:  
       - profileId="cdm.doc.body", tenantId=..., topK, and projectKeyIn filters.  
     - The test asserts that:  
       - results are sorted by score descending,  
       - only entries whose metadata match the filters are returned,  
       - nodeIds in the results correspond to inserted entries.  
     - Suggested path: `apps/metadata-api/src/brain/vectorSearch.test.ts`.

4) Normalized metadata keys allow cross-source querying  
   - Type: integration  
   - Evidence:  
     - A test seeds entries for at least two sources (e.g., a Jira work item and
       a Confluence doc) where both share a common logical project key and tenant.  
     - Both entries are indexed with the same `project_key` and appropriate
       `profile_kind` values (e.g., "work" and "doc").  
     - A query via `BrainVectorSearch.search` with:  
       - tenantId=..., projectKeyIn=[that project],  
       - profileKindIn including both "work" and "doc"  
       returns both nodeIds.  
     - Suggested path: `apps/metadata-api/src/brain/indexMetadataNormalization.test.ts`.
