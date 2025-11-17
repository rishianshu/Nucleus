# Spec: Graph Store Abstraction

## Context & Goal
- Metadata entities, edges, annotations, and embeddings form the core “graph” for every tenant/project.
- Today this graph lives in Postgres tables, but future iterations may move parts of it to purpose-built graph databases or services.
- We need a code-level abstraction so ingest/serving layers depend on a stable API rather than the underlying storage engine.

## Requirements
- **Multi-tenant aware**: every API call must include `tenant_id` and `project_id` (per `security-rls.md`). Calls missing these identifiers fail fast.
- **Entity lifecycle**: create/update/delete/list entities with optimistic concurrency (`version`) and audit metadata (`spec_ref`, `source_system`).
- **Edge lifecycle**: same semantics as entities; prevents cross-tenant edges unless explicit shared projects exist.
- **Annotation & embedding support**: attach structured annotations and pgvector-backed embeddings via the same GraphStore API.
- **Capabilities discovery**: adapters advertise features (e.g., vector search, shortest-path) so callers can degrade gracefully.
- **Storage neutrality**: interface does not leak Postgres column names. Instead, it operates on canonical types defined in `packages/metadata-core`.
- **Transactional guarantees**: adapters must document their transactional behavior. Postgres adapter leverages single-transaction semantics; other adapters must emulate or document compensating logic.
- **Observability**: GraphStore calls emit structured logs (`agent`, `directive`, `tenant_id`, `project_id`) and expose metrics for latency/error rate.

## Design
- Define `GraphStore` interface in `packages/metadata-core` that covers entity, edge, annotation, embedding, and search operations.
- Provide a `PostgresGraphStore` adapter that wraps Prisma/Postgres implementation (leveraging the existing `PrismaMetadataStore` but accessed via GraphStore methods).
- Future adapters (`Neo4jGraphStore`, `DocumentGraphStore`, etc.) implement the same interface and register via factory.
- Configuration selects the adapter via environment variable (`GRAPH_STORE_DRIVER`, default `postgres`).
- Client code (Meta API, workers, designer tooling) consumes `GraphStore` from `metadata-core` instead of directly touching Prisma/file stores.

## Interfaces
- `GraphStore` (TypeScript) methods:
  - `upsertEntity(entity: EntityInput, context: TenantContext): Promise<Entity>`
  - `getEntity(id, context)`
  - `listEntities(filter, context)`
  - `upsertEdge(edge, context)`
  - `listEdges(filter, context)`
  - `annotateEntity(annotation, context)`
  - `putEmbedding(embedding, context)`
  - `searchEmbeddings(query, context)`
  - `deleteEntity/Edge`
  - `capabilities(): GraphStoreCapabilities`
- `GraphStoreCapabilities` enumerates supported features (vector search, path queries, TTL, etc.).

## Storage Adapters
- **PostgresGraphStore**
  - Uses Prisma client and respects existing RLS policies.
  - Implements vector search via pgvector (per ADR-0002).
  - Emits SQL traces for slow queries.
- **Shared store contracts**
  - Graph adapters leverage the platform-wide object/KV/JSON/code store abstractions defined in `metadata-core`, keeping blob storage, checkpoints, and source snippets swappable per environment.
- **FileGraphStore** (optional)
  - Wrap the current FileMetadataStore for local/offline usage.
  - Limited capabilities; vector search not supported (advertised as false).
- Additional adapters register via factory map keyed by driver name.

## Deliverables
1. New `GraphStore` interface + shared types inside `packages/metadata-core`.
2. Postgres and (optionally) file-backed adapters implementing the interface.
3. Factory helper `createGraphStore(driver: string)` that loads the correct adapter based on configuration.
4. Meta API / workers updated to request `GraphStore` instead of directly calling `MetadataStore` when performing graph operations.
5. Observability hooks (logging + metrics) around GraphStore methods.

## Acceptance Criteria
- Code compiles with GraphStore interface and default Postgres adapter.
- Feature flag/env var switches between Postgres and file adapters without code changes.
- Unit tests cover GraphStore interface and adapter capability reporting.
- Documentation updated (this spec + README references) so future connectors know how to add adapters.
- Existing functionality (entity/edge mutations) continues to work; integration smoke test confirms GraphQL queries/mutations succeed after refactor.

## Open Questions
- Should GraphStore fully replace MetadataStore or wrap it? (Initial plan: GraphStore delegates to MetadataStore until full migration.)
- How do we model long-running graph queries (e.g., pathfinding) in the interface?
- Do we need batch APIs for bulk ingestion, or can callers loop with retry helpers?
