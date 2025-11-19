# Plan — semantic-sources-trio-story-v1

1. **Scaffold docs + capabilities matrix**
   - Create `docs/nucleus/semantic-sources/` tree and stub the required markdown files.
   - Populate `CAPABILITIES-MATRIX.md` with the per-source capabilities + emits table (AC1).

2. **Define CDMs and ingestion contract docs**
   - Fill `CDM-WORK.md`, `CDM-DOCS.md`, `CDM-FILES.md` with field tables + identity formulas (AC2).
   - Author `INGESTION-CONTRACT.md` detailing listUnits/syncUnit/checkpoint/backoff per source (AC3).

3. **Signals, KB/vector, and GraphQL surfaces**
   - Write `SIGNALS.md` (discovery + enrichment + idempotency) (AC4).
   - Document `KB-MAPPING.md` + `VECTOR-PROFILES.md` for nodes/edges and indexing (AC5).
   - Produce `GRAPHQL-INGESTION-API.md` describing additive queries/mutations and shapes (AC6).
