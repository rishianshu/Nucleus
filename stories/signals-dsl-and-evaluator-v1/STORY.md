# Story — signals-dsl-and-evaluator-v1

- 2025-12-11T07:25Z | Added DSL v1 parser + evaluator for work-stale/doc-orphan signals, admin-only GraphQL `evaluateSignals` mutation and CLI runner, updated seeded definitions, docs (SIGNALS_DSL_AND_EVALUATOR), and signal tests (`pnpm --filter @apps/metadata-api test:signals`).
- 2025-12-11T07:50Z | Full `pnpm ci-check` green with Docker stack (prisma generate/migrate, metadata-api/ui builds, signal tests, Playwright auth/lifecycle, mypy).
