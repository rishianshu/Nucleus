# SPEC — CDM source provenance v1

## Problem

CDM models (work/docs) represent normalized semantic entities, but agents and downstream apps often need to:

- Understand **where** a CDM row came from (which system/endpoint).
- Reconstruct or inspect the **raw source payload** (within reasonable size limits).
- Provide a one-click **"open in source"** link for human workflows.
- Potentially re-probe the source directly via UCL using a stable identifier.

Currently:

- Some CDM tables have source-ish fields (e.g. `source_issue_key`, `source_item_id`), but these are not consistent, and there is no common provenance shape.
- There is no standard field for a deep-link URL.
- Raw source payloads are not available on CDM rows, making some agentic tasks harder or dependent on re-reading from the source over the network.

We need a minimal, consistent provenance footprint on CDM Work/Docs rows without turning CDM into a full data warehouse.

## Interfaces / Contracts

### 1. CDM schema changes (work/docs)

We extend CDM work and CDM docs tables with provenance fields. Exact names can be adapted to existing conventions; suggested shape:

For **CDM work item** table (e.g. `cdm_work_item`):

```sql
ALTER TABLE cdm_work_item
  ADD COLUMN source_system TEXT NULL,
  ADD COLUMN source_id TEXT NULL,
  ADD COLUMN source_url TEXT NULL,
  ADD COLUMN raw_source JSONB NULL;
```

For **CDM doc item** table (e.g. `cdm_doc_item`):

```sql
ALTER TABLE cdm_doc_item
  ADD COLUMN source_system TEXT NULL,
  ADD COLUMN source_id TEXT NULL,
  ADD COLUMN source_url TEXT NULL,
  ADD COLUMN raw_source JSONB NULL;
```

Semantics:

- **source_system**:
  - A short, stable identifier of the upstream system family (e.g. "jira", "confluence", "onedrive").
  - Optional if an existing endpoint/connector field already captures this, but recommended for quick filtering.
- **source_id**:
  - Canonical identifier in the source system:
    - Jira: issue id or key (choose one and document it, e.g. JRA-123 or numeric id).
    - Confluence: content id.
    - OneDrive: driveItem id.
  - Must be stable enough to re-fetch the record via UCL.
- **source_url**:
  - A deep link that, when opened in a browser with rights, shows the original item in the source UI.
  - Format is connector-specific; construction logic lives in the CDM mapper for that connector.
- **raw_source**:
  - A JSONB blob of the source payload or a reasonably bounded subset (e.g. metadata fields, not full binary docs).
  - Should be small enough to store in Postgres; for large docs, keep content in object storage and store only metadata here.

Corresponding TS row types (simplified):

```ts
interface CdmWorkItemRow {
  // existing fields…
  source_system: string | null;
  source_id: string | null;
  source_url: string | null;
  raw_source: unknown | null;
}

interface CdmDocItemRow {
  // existing fields…
  source_system: string | null;
  source_id: string | null;
  source_url: string | null;
  raw_source: unknown | null;
}
```

### 2. CDM ingestion mappers

Each semantic source mapper (Jira, Confluence, OneDrive) is responsible for populating provenance fields when building CDM rows.

Examples:

- **Jira work items**:
  - `source_system` = "jira".
  - `source_id` = issue.id or issue.key (choose and document).
  - `source_url` = `https://<jira-host>/browse/<issue.key>`.
  - `raw_source`:
    - full issue JSON minus large fields (e.g. attachments) or a curated subset of fields.
- **Confluence docs**:
  - `source_system` = "confluence".
  - `source_id` = content.id.
  - `source_url` = `https://<confluence-host>/spaces/<spaceKey>/pages/<content.id>` (or official view URL).
  - `raw_source`:
    - metadata JSON (title, type, labels, space, etc.), not full storage format body if too large.
- **OneDrive docs**:
  - `source_system` = "onedrive".
  - `source_id` = driveItem.id.
  - `source_url` = driveItem.webUrl.
  - `raw_source`:
    - metadata JSON for the driveItem, not the file contents.

In all cases:

- If a field cannot be populated (e.g., no stable URL), it may remain NULL; this should be documented.

### 3. CDM explorers / GraphQL API

Expose provenance fields where they are useful:

- Work/CDM GraphQL types gain optional fields:
  - `sourceSystem`, `sourceId`, `sourceUrl`, `rawSource` (raw may be debug-only).
- UI/CDM explorers:
  - Show a small "Open in Source" button using `sourceUrl` on work/doc detail pages.
  - Optionally surface `sourceSystem` and `sourceId` in the detail sidebar or a debug section.
  - `rawSource` can be exposed behind a "view raw" / "developer mode" toggle to avoid overwhelming normal users.

No existing fields are removed or repurposed.

### 4. Backfill strategy

For existing rows:

- Prefer not to run a heavy online backfill in this slug.
- Instead:
  - Ensure new ingestion runs populate provenance fields.
  - Optionally provide a CLI/script to backfill provenance for a small number of endpoints in dev/test.
  - Treat NULL provenance fields as "unknown" for existing rows until a dedicated backfill slug is created.

## Data & State

- CDM tables grow by four nullable columns each (work/docs).
- No change to ingestion or signals state models; only CDM row shape and ingestion mapping.

Indexes:

- For v1, no new indexes are strictly required. If queries on `source_system` / `source_id` become common, a follow-up slug can add indexes.

## Constraints

- Raw payloads must not include large binary content (PDFs, Office docs); these belong in the object store. Use curated metadata JSON instead.
- SourceUrl must be treated as untrusted user content in the UI (no inline scripting; just hyperlink).
- Migrations must be additive and reversible.

## Acceptance Mapping

- AC1 → Schema and TS models updated, migrations exist for CDM work/docs.
- AC2 → Jira/Confluence/OneDrive mappers populate provenance fields for new ingestions.
- AC3 → GraphQL/API and UI explorers expose provenance fields appropriately.
- AC4 → Docs updated with provenance semantics and patterns for future CDM models.
- AC5 → `pnpm ci-check` passes.

## Risks / Open Questions

- R1: Raw JSON blobs can grow over time if not curated; we mitigate by explicitly limiting which fields we store in `raw_source` and documenting this.
- R2: Source URL formats may change if upstream systems change; connectors should centralize URL construction to ease updates.
- Q1: Should `sourceSystem` be deduced exclusively from endpoint/connector type instead of stored per-row? For v1 we choose to store it explicitly for convenience, while still being derivable from endpoint metadata if needed.
- Q2: Should we add provenance to other CDM entities (projects, users, datasets) in this slug? For v1 we focus on work/docs and document the pattern for later extension.
