# Acceptance Criteria

1) KVStore interface and DB schema are specified
   - Type: docs / schema
   - Evidence:
     - A documented KVStore interface exists in a spec file (e.g., docs/meta/nucleus-architecture/STORES.md or similar).
     - The conceptual DB schema for kv_entries (or equivalent) is described, including:
       - namespace, scopeId, key, value, version, updatedAt fields.
     - Migration guidance from the current file-backed KV is documented (import vs reset).

2) ObjectStore interface is specified with streaming semantics
   - Type: docs / schema
   - Evidence:
     - A documented ObjectStore interface defines operations: putObject, getObject, deleteObject, listObjects.
     - Semantics for buckets, keys, metadata, and streaming read/write are clearly described.
     - At least two backend strategies (S3-compatible and local filesystem) are mentioned with high-level tradeoffs.

3) Stores architecture is documented
   - Type: docs
   - Evidence:
     - A Stores architecture document lists:
       - MetadataStore, GraphStore, SignalStore, KvStore, ObjectStore.
       - Responsibilities of each store.
       - Which modules (UCL, ingestion, Brain API, Workspace) use each store.
     - The document clearly separates KV vs Object vs Graph vs Metadata vs Signal responsibilities.

4) Ingestion Source→Staging→Sink spec is updated to use stores
   - Type: docs
   - Evidence:
     - docs/meta/INGESTION_AND_SINKS.md (or an equivalent ingestion architecture doc) is updated to:
       - Show Source reading from upstream via UCL connectors.
       - Show Staging writing chunks to ObjectStore and checkpoints to KvStore.
       - Show Sink reading from ObjectStore and updating CDM or external endpoints.
     - Temporal workflows are described as passing object references instead of large payloads.

5) Brain/Workspace docs reference store interfaces only
   - Type: docs
   - Evidence:
     - Brain API / Workspace integration docs avoid referencing file-based KV or direct DB tables.
     - They describe interactions with KVStore and ObjectStore via their interfaces.
     - Any mention of UCL/ingestion staging uses ObjectStore terminology (buckets, keys) rather than ad-hoc staging.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after adding docs and schemas.
     - No tests are skipped or removed as part of this slug.
