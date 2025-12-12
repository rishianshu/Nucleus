# Story — brain-vector-index-foundation-v1

- 2025-12-12: Added pgvector-backed schema/migrations with seeded profiles, implemented Prisma stores/indexer/search for brain vector index, and wrote AC1–AC4 tests; still need to run prisma generate/migrations and `pnpm --filter @apps/metadata-api test:brain` on a pgvector-enabled stack.
