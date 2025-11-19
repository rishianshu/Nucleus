- title: Semantic Sources Trio (Jira · Confluence · OneDrive) — CDM & Ingestion Story v1
- slug: semantic-sources-trio-story-v1
- type: feature
- context:
  - Nucleus Endpoints & Capabilities (metadata.*, ingest.*, semantic:*, index:*)
  - Ingestion surface (separate from Metadata & Index)
  - KV checkpoints in Semantic KV Store
  - KB/Graph (GraphStore on Postgres) + Meta-KB
  - Signals (EPP + metric/control) + phases (raw/hypothesis/normalized/enriched)
  - ADR-UI / ADR-Data-Loading patterns
- why_now: We want Jira, Confluence, and OneDrive in Milestone 2 without divergence. A single story must define a unified capability model, CDMs, per-unit ingestion contracts (project/space/drive), checkpoints, emitted signals, KB edges, and vector indexing profiles—so later implementation slugs can execute in parallel with no redesign.
- scope_in:
  - Capabilities matrix per vendor (Jira/Confluence/OneDrive) and declared emittable signal domains.
  - CDMs:
    - Jira → `work.item`, `work.user`, `work.comment`, `work.worklog`, `work.attachment`, `work.link`.
    - Confluence → `doc.page`, `doc.comment`, `doc.attachment`, `doc.space`, `doc.link`.
    - OneDrive → `file.item`, `file.folder`, `file.link` (+ minimal `doc.page` mapping for Office files if available).
  - Ingestion contract (per-unit):
    - Jira: per **project**; Confluence: per **space**; OneDrive: per **drive/folder**.
    - Incremental via updated/ delta tokens; rate-limit/backoff; KV checkpoint schema; schedule semantics.
  - Signals (discovery + enrichment): domain/verb lists, examples, and idempotency/provenance rules.
  - KB wiring: nodes/edges to upsert; scope vector (Org/Domain/Project/Team); provenance/phase on writes.
  - Vector profiles: chunking/fields per domain (work/doc/file) and index namespace per scope.
  - GraphQL surfaces (additive) for managing semantic ingestion: listUnits, enable/disable, schedule, status.
- scope_out:
  - Temporal workflows, resolvers, or UI screens (separate implementation slugs).
  - Full preview/profile pipelines (separate slugs).
- acceptance:
  1. Capabilities & “emits” domain patterns documented for all three sources.
  2. CDM field mappings & identity rules defined for work/doc/file entities.
  3. Ingestion contract (listUnits/syncUnit/checkpoint) & error/backoff semantics defined per source.
  4. Emitted Signal types (discovery + enrichment) enumerated with examples and idempotency guarantees.
  5. KB upsert mapping (nodes/edges, scope & provenance) and vector profiles documented.
  6. GraphQL management surfaces for ingestion (arguments & response shapes) defined additively.
- constraints:
  - Vendor-agnostic core; vendor specifics live in drivers but not in public contracts.
  - Additive GraphQL only; no breaking changes.
  - Scoped identities (Org/Domain/Project/Team) are mandatory.
  - Idempotent re-runs via `(endpointId, source_event_id)` or equivalent.
- non_negotiables:
  - Provenance + phase on every signal and KB write.
  - No cross-org leakage; scope must partition IDs, stores, and index namespaces.
  - Rate-limits/backoff must be part of the contract.
- refs:
  - semantic-endpoints-and-capabilities-story-v1
  - signals-dsl-and-runtime-story-v1
  - kb-core-model-and-graph-apis-v1
  - kb-discovery-wiring-v1
- status: in-progress

