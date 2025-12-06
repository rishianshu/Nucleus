# STORY — semantic-onedrive-source-v1

## Timeline
- 2025-12-05T11:27Z — Run blocked: missing OneDrive Graph credentials (tenant/client_id/client_secret), target drive/root path, and Graph access confirmation; cannot implement/test endpoint, metadata, or ingestion without them.
- 2025-12-05T11:32Z — Unblocked: decision to use stubbed OneDrive Graph harness via `ONEDRIVE_GRAPH_BASE_URL`; proceed to implement endpoint/metadata/ingestion against stub, keeping real Graph/manual verification out-of-band.
- 2025-12-05T14:22Z — Progress: Rebuilt OneDrive endpoint with metadata subsystem + ingestion planner/worker + CDM mapping against stub; added template extras/gating; targeted pytest + tsx ingestion catalog tests passing.
- 2025-12-06T03:33Z — Success: Added workflow timeouts and fake-mode bypass for endpoint templates/connection tests; cleaned OneDrive/Jira/Confluence imports/metadata wiring for mypy; METADATA_FAKE_COLLECTIONS=1 `pnpm ci-check` (metadata-auth + metadata-lifecycle) and `pnpm mypy` all green.
