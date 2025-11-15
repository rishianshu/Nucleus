# Spec: Harvester Service

## Context & Goal
- Define behaviour for Python-based harvester services that ingest data from external systems and emit normalized item batches.
- Ensure connectors run within guardrails for memory, batch size, and credential handling, using KV checkpoints for progress.
- Provide architecture for ExecutionTool/Context abstraction and outbox/subscriber pipeline into the database.

## Technology & Boundaries
- Implemented in Python, orchestrated via `meta-py` workers (see meta-worker spec).
- ExecutionTool/Context pattern: ExecutionTool handles source-specific API calls; Context provides shared services (KV client, logging, metrics).
- Python code must not embed secrets; all credentials retrieved via `credential_ref` from vault at runtime.

## Connectors
- Each source (OneDrive, Confluence, GitHub, etc.) implements a `Connector` interface:
  - `prepare()` fetches configuration, validates connectivity.
  - `fetch_pages(cursor, page_size)` yields pages respecting source rate limits.
  - `transform(page)` returns list of normalized items and metadata.
- Connectors declare supported batch size and max concurrency; values stored in spec.
- Connectors must map source payloads to contract fields (`normalized-item.md`).

## Batch Handling & Memory Ceilings
- Standard batch size: 100 items; connectors can negotiate between 50-500 depending on API constraints.
- In-memory footprint per batch limited to 50 MB; larger batches must stream to temp storage or split.
- Compression optional before outbox publish if payload > 10 MB.
- Emit warning log when near memory ceiling; adjust page size downward automatically.

## Outbox / Subscriber Pattern
- Harvester writes normalized item batches to an outbox table (`harvest_outbox`) with fields `batch_id`, `tenant_id`, `payload`, `spec_ref`, `created_at`.
- Meta worker subscriber polls outbox, deserializes payload, and persists via deterministic upserts.
- Outbox entries marked `processed` only after subscriber commits to database; use CAS to avoid double processing.
- Outbox retention: keep processed entries 48 hours for debugging; purge via scheduled job.

## KV Usage
- Store checkpoints per source using keys `tenant/<tenant_id>/project/<project_id>/harvest/<source>/cursor`.
- Value includes `cursor_token`, `batch_id`, `item_count`, `spec_ref`.
- CAS semantics enforce single writer; conflicts cause harvester to back off and retry.
- For partial failures, write temporary key `<...>/partial` with progress snapshot; subscribers read for diagnostics.

## Guardrails & Policies
- Never log raw secrets or include them in normalized items.
- Reject API responses that embed raw blobs; instead request signed URL workflow via meta API.
- Enforce rate limits per source; respect HTTP `Retry-After` headers.
- Capture provenance metadata (source system, fetch time, spec version) on every item.
- Validate output against contract before publishing; invalid records quarantined with reasons.

## Workflow Steps
1. Retrieve connector config and credentials via `credential_ref`.
2. Load cursor from KV.
3. Fetch pages from source with rate limit awareness.
4. Transform payloads into normalized items and check contract compliance.
5. Publish batches to outbox with deterministic `batch_id`.
6. Update KV cursor using CAS upon successful publish.
7. Log completion, metrics, and emit notifications if thresholds crossed.

## Error Handling
- Transient API errors -> retry with exponential backoff (30s to 10m).
- Contract validation failure -> quarantine item, log `ERROR`, continue with others.
- Cursor conflict -> log `WARN`, retry up to 5 times before escalation.
- Credential failure -> log `FATAL`, halt connector, notify security channel.

## Metrics & Logging
- Metrics: `harvest_batches_total`, `harvest_items_total`, `harvest_quarantined_total`, `harvest_latency_seconds`.
- Logs follow taxonomy with `agent=harvester`, `directive=<source>`.
- Include `batch_id`, `cursor_token`, `item_count`, `retry_attempt`.

## Acceptance Criteria
- Connectors emit normalized item batches that pass contract validation.
- Outbox/subscriber pipeline delivers batches to database exactly once.
- KV checkpoints advance deterministically with CAS guards.
- Memory and batch size constraints respected; warnings emitted when thresholds approached.
- Secrets never logged or stored; credential path documented in spec.

## Open Questions
- Should we support streaming connectors with real-time events?
- How to auto-tune batch sizes based on API feedback?
- Do we need multi-region outbox replication for redundancy?
