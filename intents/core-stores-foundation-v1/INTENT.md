- title: Core stores foundation (KV + object) v1
- slug: core-stores-foundation-v1
- type: feature
- context:
  - docs/meta/nucleus-architecture/*
  - docs/meta/INGESTION_AND_SINKS.md
  - docs/meta/ENDPOINTS.md
  - existing KV store implementation (file-backed)
  - GraphStore and MetadataStore clients
  - new UCL (Go) connectors and Temporal activities
- why_now: Nucleus is evolving from a metadata-only brain into a shared platform for ingestion and Workspace-style actions. The current storage story is fragmented: KV checkpoints are file-backed, there is no first-class ObjectStore for Git endpoints or Source→Staging→Sink, and store abstractions are implicit rather than explicit. We need a clean, language-agnostic foundation for KV and object storage so UCL, ingestion, and Brain APIs can share consistent capabilities and we can later swap backends without redesign.
- scope_in:
  - Define a KVStore interface and contract (namespace/key/value/version semantics) and specify a DB-backed implementation to replace the current file-backed KV.
  - Define an ObjectStore interface and contract (bucket/object, metadata, streaming read/write) suitable for Git endpoints and ingestion staging.
  - Describe the “Stores” module boundary, listing all core stores (MetadataStore, GraphStore, SignalStore, KVStore, ObjectStore) and their responsibilities.
  - Document how Source→Staging→Sink ingestion will use ObjectStore and KVStore conceptually, without changing current ingestion code.
- scope_out:
  - Implementation of SignalBus or event fanout (to be handled by a separate slug).
  - Any changes to UCL connector business logic beyond referencing store interfaces.
  - Detailed performance tuning for specific backends (S3 vs MinIO vs local FS).
  - Major GraphStore schema changes (only conceptual alignment is in scope).
- acceptance:
  1. KVStore interface and DB-backed schema are specified, including migration rules from the current file-backed KV.
  2. ObjectStore interface is specified with clear semantics for namespaces, object IDs, metadata, and streaming IO, and at least two backend strategies are described.
  3. A Stores architecture doc lists MetadataStore, GraphStore, SignalStore, KVStore, and ObjectStore, including responsibilities and interaction patterns.
  4. The ingestion Source→Staging→Sink spec is updated to reference ObjectStore and KVStore instead of ad-hoc staging, for both generic and UCL-based connectors.
  5. Brain API/Workspace-facing docs reference stores only via these interfaces (no store-specific knowledge leaks into higher layers).
- constraints:
  - Interfaces must be language-agnostic and usable from Go (UCL) and TS (metadata-api) via gRPC/HTTP or shared client libraries.
  - KVStore must be backed by a DB (no filesystem kv) and support multi-tenant scoping (workspace/project/endpoint).
  - ObjectStore design must support large payloads via streaming (no Temporal payload bloat).
  - No breaking changes to existing public APIs; this slug is docs + contracts only.
- non_negotiables:
  - Store boundaries must be explicit: KV vs Object vs Graph vs Metadata vs Signal are separate responsibilities.
  - Source→Staging→Sink must conceptually route bulk data through ObjectStore, not through Temporal payloads.
  - KVStore must be safe for ingestion checkpoints (idempotent, versioned) and not rely on local disk.
- refs:
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/kb-meta-registry-v1.md
  - docs/meta/nucleus-architecture/metadata-endpoint-registry-temporal.md
  - index-req.md (Workspace events, Signals, IndexableDocument)
- status: in-progress
