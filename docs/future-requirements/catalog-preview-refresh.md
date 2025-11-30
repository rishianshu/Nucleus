# Catalog Preview Refresh Pipeline (Future Enhancement)

## Context
The metadata UI now shows cached preview rows instantly via `catalogDatasetPreview`, while live previews continue to be fetched only when a user clicks **Preview dataset**. This keeps the catalog responsive, but fresh preview rows are not persisted anywhere; each live preview run populates the UI cache only for the current session, and freshly collected datasets might never show non-empty previews unless an operator manually triggers one.

## Problem Statement
Operators want the catalog to display representative sample rows without manual work. Ideally:
- After a metadata collection run, the platform should publish sample rows into the catalog record so downstream users see up-to-date previews immediately.
- Preview workflows should be decoupled from catalog queries but still have a background path to refresh cached rows (e.g., via async jobs or coupling to collection completion events).
- The system must avoid hammering upstream APIs, respect rate limits, and provide auditability of when/why previews were refreshed.

## Proposed Requirements
1. **Background Preview Refresh**
   - When `triggerEndpointCollection` succeeds (manual or scheduled), enqueue a lightweight task that requests preview rows for each dataset tied to that endpoint.
   - Tasks should call the existing Temporal `previewMetadataDataset` workflow and persist the returned rows (with sampledAt) back into the catalog row (`payload.preview.rows`).
   - Rate-limit refresh jobs per endpoint/dataset and include exponential backoff on failures.

2. **Preview Persistence Contract**
   - Extend ingestion collection completion handlers or a dedicated API mutation so the platform can write preview samples into the metadata store.
   - Define a TTL/size cap (e.g., max 50 rows, drop large fields) to keep catalog payloads lightweight.
   - Store metadata about who/what refreshed the preview (`preview.sampledBy`, `preview.refreshSource`).

3. **UI Surfacing**
   - Show whether a preview row set is cached vs. freshly sampled.
   - If cached data is older than a configurable window (e.g., 24h), surface a subtle banner suggesting a manual refresh.

4. **Operational Controls**
   - Add configuration toggles (env vars or per-endpoint policy) to disable automatic preview refresh for sensitive sources.
   - Emit audit logs/metrics whenever background preview refresh runs start/complete/fail.

## Open Questions
- Should previews run for every dataset or only those marked as “previewable” in template metadata?
- Do we need per-dataset throttles (e.g., max one refresh per hour) beyond endpoint-level limits?
- What is the best persistence layer for large previews (Prisma JSON vs. object storage pointer)?

## Next Steps
1. Design the metadata store schema updates for preview provenance/TTL.
2. Add API/worker hooks to upsert preview rows after collection completion.
3. Implement Temporal workflow or simple queue processor for background preview refresh jobs.
4. Update UI to show cached age + “last refreshed automatically by collection”.
5. Document operational runbooks (retry policies, log locations, manual override command).
