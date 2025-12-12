# Story — brain-search-graphrag-api-v1

- 2025-12-12: Added brainSearch GraphQL schema/types plus BrainSearchService (vector search → KG expansion → episodes → prompt pack) with deterministic hashing embedder; new GraphRAG integration tests pass via `pnpm exec node --import tsx --test src/brain/brainSearch.test.ts`; broader `test:brain` run is blocked by missing metadata Postgres at localhost:5434.
