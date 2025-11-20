## TODO — graphstore-identity-hardening

- [x] Inspect all GraphStore call sites (`syncRecordToGraph`, tests, CLI) to understand inputs & required scope info.
- [x] Draft Prisma schema changes (GraphNode/GraphEdge models + indexes) + generate SQL migration; mirror schema for file-store manifests.
- [x] Implement logical key + scope/origin builder helpers with unit tests.
- [x] Extend `MetadataGraphStore` API/types to require identity/scope and persist to new storage.
- [x] Update ingestion + resolvers to compute scope/origin and apply default scope filters; reject cross-tenant edges.
- [x] Implement backfill job (batching + collision report) and wire into tooling/README.
- [x] Expand GraphQL schema/tests to expose `identity` + `scope`; ensure compatibility.
- [x] Wire GraphQL clients/UI (if any) to new fields once exposed (follow-up PR).
- [x] Run full unit/integration/Playwright suites + capture results before final handoff.
