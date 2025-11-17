## `intents/metadata-identity-hardening/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Two endpoints with same table name do not collide
   - Type: integration
   - Evidence:
     - Given endpoint A (`sourceId = "srcA"`) and endpoint B (`sourceId = "srcB"`),
     - Both expose a dataset `public.users`,
     - After collection runs for both:
       - There exist two distinct `MetadataRecord` entries in `catalog.dataset` with:
         - IDs differing due to different sourceIds
         - labels reflecting their respective endpoints/sources,
       - There exist two distinct graph entities for `catalog.dataset` (different IDs/canonicalPaths),
       - No entity or record is overwritten when the second endpoint is collected.

2) Repeated collections for the same dataset update, not duplicate
   - Type: integration
   - Evidence:
     - Given an endpoint and dataset key (`sourceId`, `projectId`, `schema`, `table`),
     - Run collection twice for the same endpoint:
       - Only one `MetadataRecord` for that dataset key exists (same ID),
       - Its `payload` is updated (e.g. changed row_count or schema),
       - Only one graph entity exists, updated with latest properties (no duplicates in GraphStore).

3) Legacy records remain readable and stable
   - Type: integration
   - Evidence:
     - Existing `catalog.dataset` records created before the change are still returned by dataset queries,
     - Graph consumer code querying by labels/filters continues to function,
     - No runtime errors occur when `syncRecordToGraph` processes an old record whose ID is not in canonical form.

4) No ad-hoc identity in ingestion path
   - Type: unit/integration
   - Evidence:
     - Static/structural tests or code-level checks show that:
       - `persistCatalogRecords` is the single place deriving dataset record IDs for `catalog.dataset`,
       - `syncRecordToGraph` uses the canonical identity logic,
       - No other ingestion path constructs metadata/graph IDs using simple table names or random UUIDs for catalogs.

5) GraphStore and MetadataStore responsibilities separated
   - Type: unit/integration
   - Evidence:
     - Tests verify that:
       - MetadataStore is always called with canonical IDs.
       - GraphStore never derives IDs from arbitrary strings; it uses either:
         - `record.id` for `catalog.dataset`, or
         - canonical dataset key computed from payload,
       - There is no direct GraphStore write that bypasses the canonical identity derivation for catalog datasets.


⸻

