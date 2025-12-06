## 2025-12-06 — KB ACL model and ingestion outline
- Add KB node types: `principal.user`, `principal.group` (docs/meta/kb-meta.defaults.json).
- Add KB edge types: `HAS_MEMBER` (group→user), `CAN_VIEW_DOC` (principal→doc) with source/synced_at metadata planned.
- Ingestion path (v1 outline):
  - Confluence ACL unit: fetch space/page restrictions (stub/real), map to principals by email/name, emit `CAN_VIEW_DOC`; emit `HAS_MEMBER` for groups → users when available.
  - OneDrive ACL unit: fetch `/drive/items/{id}/permissions` (stub/real), map shares to users/groups via email/id, emit `CAN_VIEW_DOC`.
  - Use existing ingestion/Temporal plumbing; small payloads can write directly to KB and/or a denormalized RLS table keyed by (principal_id, doc_id).
- RLS strategy: secured docs resolvers default `secured=true`; resolve principal from auth user/email; allow admin `secured=false`. Docs Explorer to call secured path by default.

## 2025-12-06 — RLS storage/index strategy
- Add denormalized RLS table in the CDM docs sink (e.g., `cdm_docs.cdm_doc_access`) keyed by `(principal_id, doc_cdm_id, source_system)` with `principal_type`, `granted_at`, `synced_at`, `dataset_id`, `endpoint_id` for filtering.
- ACL ingestion units upsert both KB edges and this RLS table to avoid KB query fan-out at read time.
- Doc resolvers/listing will accept `secured` flag; when `secured=true`, join/filter against the RLS table using the current principal (derived from auth email/identity, plus group expansion if available). `secured=false` remains admin-only.
