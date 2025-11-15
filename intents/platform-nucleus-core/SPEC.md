# Spec: Nucleus Core Platform

## Context & Goal
- Deliver the foundational metadata platform that supports multi-tenant ingestion, storage, retrieval, and governance for engineering assets.
- Unify entities, edges, annotations, embeddings, KV checkpoints, and MinIO blob links under a consistent model with row-level security (RLS).
- Provide baselines for SLOs and acceptance criteria that platform teams and domain specs inherit.

## Scope
- Multi-tenant support for organizations, projects, and delegated access.
- Core entity/edge/annotation tables, embedding storage, and MinIO blob pointers.
- KV semantics for coordination and progress tracking (see `kv-checkpoints.md`).
- Security: RLS policies, encryption, audit, and least privilege data paths.
- Performance and availability targets for primary reads and writes.

## Tenancy Model
- Tenants map to top-level organizations (`tenant_id`), each owning projects (`project_id`) with isolation boundaries.
- RLS enforces tenant/project scoping on entity, edge, annotation, embedding, and KV tables.
- Service-to-service calls carry a tenant claims token; anonymous calls are rejected.
- Cross-tenant sharing requires explicit grants logged in an audit table.

## Entity Model
- **Tables**
  - `meta_entities`: stores canonical descriptor for an item with fields (`entity_id`, `tenant_id`, `project_id`, `entity_type`, `display_name`, `canonical_path`, `source_system`, `spec_ref`, `created_at`, `updated_at`, `version`).
  - `meta_entity_annotations`: supports key/value annotations per entity; stores provenance and visibility scope.
  - `meta_entity_embeddings`: attaches vector embeddings (`embedding_id`, `entity_id`, `model_id`, `vector`, `hash`, `created_at`) with pgvector index.
- Entities must reference a normalized item contract and carry version history in `version`.

## Edge Model
- **Tables**
  - `meta_edges`: directional relationships (`edge_id`, `tenant_id`, `project_id`, `edge_type`, `source_entity_id`, `target_entity_id`, `confidence`, `metadata`, `spec_ref`, `created_at`).
  - `meta_edge_annotations`: fine-grained labels or overrides per edge.
- Edge writes validate both endpoints' tenancy and forbid cross-tenant edges without explicit linking spec.

## Annotation Model
- Annotations provide structured metadata overlays on entities or edges.
- Support text, numeric, and JSON payloads with constraints defined per spec.
- Enforce per-annotation visibility (`private`, `tenant`, `public`) with auditing for escalations.

## Embeddings
- Store vector representations in `meta_entity_embeddings` and `meta_annotation_embeddings` (if needed later).
- Embeddings reference `model_id` and include a `hash` to detect drift; duplicates on the same hash short-circuit writes.
- Embedding refresh jobs run per-project, using KV checkpoints to track last processed revision.

## KV Integration
- KV usage follows `kv-checkpoints.md` (compare-and-set, deterministic request IDs).
- Core platform surfaces `kvGet` and `kvPut` API operations with RLS enforcement.
- Keys include tenant/project prefix (`tenant/<tenant_id>/project/<project_id>/...`) to align with RLS.
- KV metadata ensures alignment with entity versions and embeddings updates.

## MinIO Blob Links
- Entities and annotations can reference blobs stored in MinIO using signed URLs.
- Metadata table `meta_blob_links` stores (`blob_id`, `entity_id`, `blob_uri`, `content_hash`, `size_bytes`, `encryption`, `expires_at`).
- Blobs inherit tenant/project from associated entity; RLS enforces retrieval rights.
- Blob uploads require KV coordination to avoid conflicting updates (e.g., spec revisions).

## Row-Level Security
- Enable RLS on every table with tenancy columns; default deny.
- Policies:
  - `tenant_owner`: allow access when session tenant matches row tenant.
  - `project_collaborator`: allow subset access using membership table `project_members`.
  - `service_account`: allow read/write for automation with explicit scope lists.
- Audit table `meta_access_audit` captures who accessed what, when, and why (directive/spec reference).

## Acceptance Criteria
- Can create, read, update, delete entities, edges, annotations within a tenant and project while RLS blocks cross-tenant leak tests.
- Embedding writes reject duplicate hashes and allow search queries within expected latency (see SLOs).
- KV checkpoints coordinate ingestion replays without conflict across concurrent agents.
- Blob links resolve to signed URLs with tenant-scoped policies; unauthorized access returns 403.
- Audit records exist for entity mutations and cross-project grants.

## Service Level Objectives
- **Availability**: 99.5% monthly availability for entity and edge read/write APIs per tenant.
- **Latency**: p95 GraphQL `metaEntities` query <= 400ms for projects with fewer than 100k entities; embedding search <= 700ms.
- **Durability**: No acknowledged write loss; RPO = 0 with streaming replication and daily backups.
- **Access audit**: 100% of mutations and privileged reads logged within 5 seconds.

## Out of Scope
- Domain-specific ingestion rules (see domain specs).
- Rendering or UI workflows.
- Bulk export pipelines (future ADR).

## Open Questions
- Should annotations support large JSON blobs or reference MinIO for heavy payloads?
- Do we require per-project encryption keys or is tenant-level sufficient?
- How to automate tenant creation and project membership provisioning?
