- title: Ingestion strategy unification v1
- slug: ingestion-strategy-unification-v1
- type: techdebt
- context:
  - platform/spark-ingestion (Python worker, endpoints, planners, staging)
  - platform/spark-ingestion/packages/runtime-common/src/runtime_common/endpoints/*
  - platform/spark-ingestion/temporal/metadata_worker.py
  - apps/metadata-api/src/ingestion/*
  - apps/metadata-api/src/temporal/*
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/cdm-mapper-refactor.md
- why_now: JDBC, Jira, and Confluence ingestion all work, but they use inconsistent planning and data-flow paths. Some flows still move large normalized batches across Temporal, and `metadata_worker.py` contains endpoint-specific CDM logic. This makes ingestion fragile at scale (e.g., large Confluence spaces), slows down new connectors, and conflicts with the Source → Staging → Sink design. We need a single adaptive planning interface, a strict staging-based data plane, and an endpoint-agnostic worker that delegates CDM mapping to a registry.
- scope_in:
  - Introduce a unified ingestion planning interface (units → slices/segments) used by JDBC, Jira, and Confluence endpoints.
  - Ensure all ingestion flows use SourceEndpoint → StagingProvider → SinkEndpoint; Temporal only sees handles + stats, never large record arrays.
  - Enforce the metadata-first invariant: ingestion units must map to catalog datasets emitted by metadata subsystems.
  - Integrate the CDM mapper registry so CDM mapping is endpoint-agnostic and not hardcoded in `metadata_worker.py`.
  - Align incremental/KV state handling across sources (JDBC, Jira, Confluence) via a shared contract.
- scope_out:
  - New connectors beyond the existing JDBC/Jira/Confluence families.
  - Advanced heuristics for cost-based planning (beyond simple adaptive slicing/counting).
  - A new UI design for the ingestion console (only minimal changes needed to surface unified status/fields).
- acceptance:
  1. All ingestion jobs (JDBC, Jira, Confluence) use a unified adaptive planning interface that returns segments/slices per unit.
  2. Temporal workflows never marshal large `NormalizedRecord` batches; Python activities use staging, and TS only passes small handles and stats.
  3. Ingestion runs are only created for endpoints/datasets that exist in the catalog and are enabled for ingestion; invalid combinations fail with typed errors.
  4. CDM mapping runs through a registry; `metadata_worker.py` no longer has hardcoded Jira/Confluence CDM branches.
  5. Incremental ingestion state is stored in KV with a consistent scheme and is consumed by planners for JDBC, Jira, and Confluence.
  6. `pnpm ci-check` passes with updated ingestion tests (Python + TS + Playwright where applicable).
- constraints:
  - GraphQL contracts must remain backward compatible (only additive schema changes allowed).
  - No KB-as-sink: KB remains semantic/metadata only; bulk rows land in sinks defined by ingestion config.
  - Keep ingestion idempotent and resumable per segment; re-runs must not duplicate data.
- non_negotiables:
  - Endpoint-specific logic (SQL/JQL/REST pagination, probing, planning, normalization) lives inside Python endpoints/strategies, not in TypeScript.
  - Data-plane records must never traverse Temporal in large batches; only staging handles and summary stats cross the boundary.
- refs:
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - docs/meta/nucleus-architecture/cdm-mapper-refactor.md
  - intents/ingestion-core-v1/*
  - intents/semantic-jira-source-v1/*
  - intents/semantic-confluence-source-v1/*
- status: in-progress