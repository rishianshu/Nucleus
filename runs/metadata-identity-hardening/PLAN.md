# Plan — metadata-identity-hardening

1. **Bootstrapping + Audit**
   - Document current run state (LOG/TODO) and catalog existing usages of `MetadataStore.upsertRecord` / `GraphStore.upsertEntity`, starting with:
     - `apps/metadata-api/src/temporal/activities.ts` (Persist + Graph sync pipeline),
     - `apps/metadata-api/src/schema.ts` mutations,
     - `packages/metadata-core/src/index.ts` helpers (`syncRecordToGraph`, Graph entity helpers),
     - any seeds/scripts calling `upsertRecord`.
   - Capture findings in PLAN (this file) so acceptance links back to specific code sections (AC1/AC4 prep).

2. **Canonical identity helper**
   - Implement `deriveDatasetIdentity` + imprint utility under `apps/metadata-api/src/metadata/` with unit tests (`tsx --test`); cover schema/table/source permutations (AC2).

3. **Ingestion wiring**
   - Update `persistCatalogRecords` to call the helper and use deterministic IDs/labels; ensure non-catalog domains remain unchanged; adjust GraphStore sync to reuse canonical identity (AC1/AC3/AC4).

4. **Testing & verification**
   - Add/refresh tests: unit (helper), API/integration (GraphQL + Prisma), and ensure Playwright e2e still passes; rerun `pnpm check:metadata-lifecycle` + `pnpm check:metadata-auth`.
   - Current focus: stabilize the metadata collections filter Playwright spec so it works against the single metadata backend (API @4010, UI @5176) without flaky scrolling.

5. **Wrap-up**
   - Update TODO/LOG/DECISIONS as needed; record any legacy migration considerations; confirm ACCEPTANCE items, update STATE/STORY on success.
