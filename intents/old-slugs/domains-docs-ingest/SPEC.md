# Spec: Docs Domain Ingestion

## Context & Goal
- Capture documentation from OneDrive, Confluence, and Markdown repositories into the Nucleus metadata platform.
- Produce searchable descriptors, chunked content, embeddings, and optional blob storage with signed URL safeguards.
- Ensure ingestion respects access controls, versioning, and acceptance criteria aligned with the core platform.

## Sources
- **OneDrive**: delta API providing drive items with permissions and version info.
- **Confluence**: REST API for pages, spaces, labels.
- **Markdown**: Git-based repositories or local paths synchronized via harvesters.

## Ingestion Flow
1. Discover new or updated documents using source-specific cursors stored in KV (`tenant/docs/<source>/cursor`).
2. Download document metadata and raw content.
3. Normalize into doc descriptors (normalized item contract) with provenance and owners.
4. Chunk content into sections (see Chunking Policy).
5. Generate embeddings for chunks and documents using configured model.
6. Store optional raw content in MinIO when required by compliance or offline search.
7. Emit edges linking documents to owning teams, services, or APIs when metadata is available.

## Chunking Policy
- Split documents into logical sections of ~500 words or less, respecting headings and bullet boundaries.
- Preserve source order; assign deterministic `chunk_id` derived from `doc_id` and section index.
- Chunks include metadata: `chunk_title`, `chunk_index`, `char_range`, `language`, `last_modified`.
- Chunks that exceed size thresholds trigger warning logs and fallback to streaming storage for manual review.

## Data Model Mapping
- `doc_descriptor` table fields: `doc_id`, `tenant_id`, `project_id`, `source_system`, `title`, `path`, `owners`, `labels`, `spec_ref`, `version`.
- `doc_chunk` table fields: `chunk_id`, `doc_id`, `sequence`, `text_preview`, `embedding_id`, `created_at`, `updated_at`.
- `doc_embedding` table fields: `embedding_id`, `doc_id`, `chunk_id`, `model_id`, `vector_hash`, `created_at`.
- `doc_blob_link` table fields: `blob_id`, `doc_id`, `chunk_id`, `blob_uri`, `content_hash`, `expires_at`.

## Embeddings
- Use pgvector-backed tables shared with core platform.
- Generate embeddings for both full documents and each chunk; store model version and hash.
- Recompute embeddings on content change; skip if hash unchanged.
- Provide search ranking based on cosine similarity plus metadata boosts.

## Blob Policy
- Raw documents stored in MinIO only when flagged by spec or regulatory requirements.
- Signed URL access limited to authorized tenants; expiration default 24 hours.
- Store content hash to detect tampering; re-upload on mismatch.
- Enforce access logging through MinIO audit events referencing doc IDs.

## Access & Security
- Enforce RLS by tenant/project; descriptors and chunks inherit permissions from sources.
- Respect source ACLs: documents marked private remain private; ingestion honors owner-provided allowlists.
- Sensitive documents flagged by labels trigger additional encryption and require security approval for access.

## Search Experience
- `metaSearch` blends doc descriptors and chunk embeddings; highlight fields include snippet context.
- Provide filters for source systems, tags, owners, and last updated range.
- Search results link to canonical path and optionally to blob download if authorized.

## Acceptance Criteria
- Ingestion stores doc descriptors with correct tenant/project and source metadata.
- Chunking produces deterministic IDs and embeddings stored without duplication.
- Optional blob storage accessible via signed URL; unauthorized access attempts return 403.
- Search queries surface newly ingested documents within SLA (target < 5 minutes from ingestion).
- KV checkpoints for each source update after successful synchronization; conflicts retried per KV spec.
- "Done" means descriptors saved, chunks indexed, optional blobs stored by signed URL when required.

## Open Questions
- Should we support document translation for search indexing?
- How to handle extremely large documents (manual approval or streaming search)?
- Need to expose per-source ingestion dashboard for stakeholders?
