- title: Ingestion Source–Staging–Sink v1 (architecture & cleanup)
- slug: ingestion-source-staging-sink-v1
- type: techdebt
- context:
  - apps/metadata-api (ingestion-core GraphQL + Temporal workflows)
  - packages/metadata-core (Ingestion* contracts)
  - platform/spark-ingestion/runtime_common/endpoints/* (Source/Sink endpoints)
  - metadata_service + metadata_worker.py
  - docs/meta/nucleus-architecture/{MAP,ENDPOINTS,INGESTION_AND_SINKS}.md
- why_now: ingestion-core-v1 introduced TypeScript-side `IngestionDriver`/`IngestionSink` abstractions and a `KnowledgeBaseSink` that partly duplicate the Python endpoint plane and Spark sink endpoints. We now have a clearer architecture: all endpoints (Source/Sink) live in Python, ingestion data-plane is Source → Staging → Sink, and TypeScript is strictly orchestration + state (KV, Prisma, KB). We need to cleanly align the code and specs to this model before we add Jira/Confluence/OneDrive ingestion.
- scope_in:
  - Define a canonical ingestion data-plane contract: **SourceEndpoint → StagingProvider → SinkEndpoint**, implemented in Python.
  - Specify a minimal Staging Provider interface (in-memory first, Kafka/object-capable later) and how Source/Sink endpoints interact with it.
  - Update ingestion-core docs and architecture so that:
    - TypeScript workflows orchestrate runs and manage KV/Prisma/KB,
    - Python endpoints + staging handle data movement.
  - Plan the removal or demotion of TypeScript `IngestionDriver`/`IngestionSink` as endpoint-like concepts, replacing them with a Python ingestion worker activity.
- scope_out:
  - Implementing full production-grade staging backends (Kafka/object storage); this slug only wires in-memory / local staging as a reference.
  - Adding real Jira/Confluence/OneDrive drivers (separate semantic-* slugs).
  - Changing GraphQL shapes or UI behavior of the Ingestion console (beyond internal wiring).
- acceptance:
  1. A new docs/meta spec describes the ingestion data-plane as **SourceEndpoint → Staging → SinkEndpoint**, including a Staging Provider contract and how it fits with existing Python endpoints and Spark sinks. 
  2. ingestion-core documentation no longer describes TypeScript `IngestionDriver`/`IngestionSink` as the primary abstraction; instead, it positions them (if kept) purely as internal orchestration helpers over Python endpoints or marks them as legacy. 
  3. TypeScript `ingestionRunWorkflow` is specified (and partially implemented) to call a Python ingestion worker activity that receives `{ endpointId, unitId, checkpoint, policy }` and returns `{ newCheckpoint, stats }`, without streaming bulk records through TS. 
  4. The spec clarifies the roles of KV (checkpoints), KB (graph metadata), and SinkEndpoints (data persistence) in the ingestion flow, matching the MAP/ENDPOINTS/INGESTION docs. 
- constraints:
  - No breaking changes to GraphQL ingestion queries/mutations in this slug.
  - Keep `make ci-check` within current bounds.
  - Favor incremental code adjustments; large refactors must be broken into clear steps in PLAN.md.
- non_negotiables:
  - There must be only one endpoint plane (Python) for Source/Sink endpoints; TypeScript must not define a parallel endpoint registry.
  - The ingestion data-plane model must be unambiguously documented as `Source → Staging → Sink`, with TypeScript confined to orchestration + state.
- refs:
  - docs/meta/nucleus-architecture/MAP.md
  - docs/meta/nucleus-architecture/ENDPOINTS.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - intents/ingestion-core-v1/*
  - intents/semantic-sources-trio-story-v1/*
- status: in-progress