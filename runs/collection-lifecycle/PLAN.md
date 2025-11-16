# Plan — collection-lifecycle

1. **Schema & Prisma groundwork**
   - Model new `MetadataCollection` per SPEC, relate endpoints + runs, add fields/indexes on `MetadataCollectionRun`, and wire Prisma migration/client regen steps.
   - Document/verify how migrations will run locally (scripts) without breaking existing data.

2. **Temporal + persistence orchestration**
   - Implement `CollectionRunWorkflow` w/ bounded retries + activities pipeline, plus helper activities (if any) that ensure `MetadataCollectionRun` rows are created/updated correctly.
   - Add schedule management utilities (create/update/delete/pause) tied to `MetadataCollection` mutations + ensure workflow IDs/schedule IDs follow contract.

3. **GraphQL API surface**
   - Extend schema with `MetadataCollection` types + new queries/mutations, update resolvers to enforce per-collection semantics + new error codes, and ensure `triggerEndpointCollection` delegates appropriately.
   - Validate data access + error handling via integration tests (AC1/AC2/AC6 coverage) plus Prisma interactions.

4. **Metadata UI & endpoint workflows**
   - Update metadata UI queries/mutations/hooks to consume new APIs, wire Endpoint “Trigger collection” action to `triggerEndpointCollection`, and enhance Collections tab with filters/status chips and endpoint context per acceptance.
   - Remove any legacy “trigger all” assumptions and ensure disabled collections display appropriate UI state.

5. **Testing & verification**
   - Add/expand GraphQL + Temporal integration/unit tests per AC3/AC4, covering skip/fail/success flows and schedule behavior.
   - Extend Playwright e2e for metadata workspace to cover new Collections filters + endpoint trigger path, ensuring manual + scheduled triggers behave and disabling/deleting stops runs.
