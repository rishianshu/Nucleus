## `intents/semantic-sources-trio-story-v1/SPEC.md`

```markdown
# SPEC — Semantic Sources Trio (Jira · Confluence · OneDrive) — CDM & Ingestion Story v1

## Problem
We need a unified, vendor-agnostic plan to onboard three semantic sources in Milestone 2. The plan must standardize capabilities, CDMs, ingestion contracts, signals, KB upserts, and vector profiles so each implementation can proceed independently and safely.

## Interfaces / Contracts

### 1) Capabilities & Emittable Domains

| Source      | Endpoint kind/vendor     | Capabilities (min)                                           | Declared emits (patterns)                           |
|-------------|---------------------------|---------------------------------------------------------------|-----------------------------------------------------|
| Jira        | `http` / `jira`          | `metadata.api`, `ingest.poll`, `semantic:work`, `index:vector-friendly` | `entity.work.*`, `process.work.lifecycle.*`         |
| Confluence  | `http` / `confluence`    | `metadata.api`, `ingest.poll`, `semantic:doc`, `index:vector-friendly`  | `entity.doc.page.*`, `entity.doc.comment.*`         |
| OneDrive    | `http` / `onedrive`      | `metadata.api`, `ingest.poll` \[+ optional `ingest.webhook`], `semantic:file`, `index:vector-friendly` | `entity.file.item.*`, `entity.file.folder.*` |

> Additive capability flags only. Drivers may support more (e.g., webhooks) but poll is the baseline.

### 2) CDM (Canonical Data Models)

#### 2.1 Work (Jira)
- **work.item**: id, source_issue_key, project_key, issue_type, status, priority, summary, description, labels[], assignee_id, reporter_id, created_at, updated_at, resolved_at?
- **work.user**: id, source_user_id, display_name, email?, active, time_zone?
- **work.comment**: id, work_item_id, author_id, body, created_at, updated_at?
- **work.worklog**: id, work_item_id, author_id, started_at, time_spent_seconds
- **work.attachment**: id, work_item_id, filename, mime_type, size_bytes, download_url
- **work.link**: (issue↔issue, issue↔doc/file) from_id, to_id, link_type OR work_item_id + target_type + target_url + target_endpoint_id?

**Identity**: `work.item::<orgId>::<projectKey>::<endpointId>::<issueKey>` (scoped; collision-proof)

#### 2.2 Docs (Confluence)
- **doc.page**: id, space_key, title, body_html/text, version, labels[], author_id, created_at, updated_at, url
- **doc.comment**: id, page_id, author_id, body, created_at, updated_at?
- **doc.attachment**: id, page_id, filename, mime_type, size_bytes, download_url
- **doc.space**: id, key, name, url

**Identity**: `doc.page::<orgId>::<spaceKey>::<endpointId>::<pageId>`

#### 2.3 Files (OneDrive)
- **file.item**: id, drive_id, parent_id?, path, name, size_bytes, mime_type, created_at, updated_at, created_by_id, modified_by_id, web_url, hash?, is_folder=false
- **file.folder**: id, drive_id, parent_id?, path, name, web_url, is_folder=true
- **file.link**: file/item references extracted from other entities (optional)

**Identity**: `file.item::<orgId>::<driveId>::<endpointId>::<itemId>`

### 3) Ingestion Contract (Per-Unit)

**Units**:
- Jira → **Project** (projectKey)  
- Confluence → **Space** (spaceKey)  
- OneDrive → **Drive/Folder** (driveId[/folderId])

**Driver interface**:
- `listUnits(endpointId) -> [{unitId, kind, displayName, stats}]`
- `syncUnit(endpointId, unitId, fromCheckpoint) -> { newCheckpoint, stats, source_event_ids[], errors[] }`
- `estimateLag(endpointId, unitId) -> duration`

**Checkpoint KV (per unit & entity type)**:
```

key:  semantic::<vendor>::<endpointId>::unit::<unitId>::entity::<domain>
val:  { last_updated_at, cursor?, last_run_id, stats }

```

**Incremental rules**:
- Jira: JQL `updated >= last_updated_at ORDER BY updated ASC`
- Confluence: content `modified >= last_updated_at`
- OneDrive: delta token or `updated >= last_updated_at`

**Rate-limit/backoff (contract)**:
- All drivers must expose `rateLimit` stats and exponential backoff behavior; retries bounded and logged into run stats.

**Error semantics**:
- Partial failures recorded with per-entity counts & sample errors.
- Idempotency: dedupe by `(endpointId, source_event_id)` or composite vendor cursor.

### 4) Signals (Discovery + Enrichment)

**Phases**: `raw | hypothesis | normalized | enriched`

**Jira (examples)**  
- `entity.work.item.created/updated/deleted`  
- `process.work.lifecycle.transitioned` (from→to)  
- `entity.work.comment.created`

**Confluence (examples)**  
- `entity.doc.page.created/updated/deleted`  
- `entity.doc.comment.created`  
- `entity.doc.page.labeled` (label add/remove)

**OneDrive (examples)**  
- `entity.file.item.created/updated/deleted`  
- `entity.file.folder.created`

**Idempotency**: `(source.endpoint_id, provenance.source_event_id)` must uniquely identify a signal; repeated replays increment `revision`.

### 5) KB Upserts & Edges

**Nodes** (new/confirmed): WorkItem, User, Comment, DocPage, DocSpace, FileItem, FileFolder.  
**Edges**:
- `DOCUMENTED_BY` (Dataset→DocPage)
- `MENTIONS` (DocPage→WorkItem or →Dataset)
- `ATTACHED_TO` (FileItem→WorkItem/DocPage)
- `RELATES_TO` (WorkItem↔WorkItem)
- `BELONGS_TO` (DocPage→DocSpace; FileItem→FileFolder/Drive)
- All writes carry `scope`, `provenance`, `phase`, `valid_from/valid_to`.

### 6) Vector Profiles (Indexing)

- **work.item**: fields = `summary + description + selected comments`; chunking = `issue` or `issue+thread`; namespace = `vec/<orgId>/work`.
- **doc.page**: fields = HTML→text; chunking = `by heading/paragraph`; namespace = `vec/<orgId>/doc`.
- **file.item**: fields = extracted text (Office/PDF/markdown) with MIME-aware parsing; chunking = `by page/section`; namespace = `vec/<orgId>/file`.

Retrieval must be **scope-filtered**; KB alignment via `REFERS_TO`/`DOCUMENTED_BY` edges.

### 7) GraphQL Surfaces (Additive)

- `semanticUnits(endpointId: ID!): [SemanticUnit!]`  
- `startIngestion(endpointId: ID!, unitId: ID!, schedule?: ScheduleInput): IngestionRun!`  
- `pauseIngestion(endpointId: ID!, unitId: ID!): Boolean!`  
- `ingestionStatus(endpointId: ID!, unitId: ID!): IngestionStatus!`

Shapes include: `lastRun`, `lag`, `enabled`, `checkpoint`, `errors[]`, `stats`.

## Data & State
- Signals tables: `signals_raw`, `signals_norm`, `signals_enriched` (partition by orgId, index by ts & entity).
- KV: per `(vendor, endpointId, unitId, domain)`; JSON values; idempotent updates.
- Graph: `kb_node`, `kb_edge` on Postgres with JSONB props + scope & provenance fields.
- Vector: per‑org namespaces; optional per‑project sub‑namespaces.

## Constraints
- No breaking APIs; only additive fields/args.
- Scope vector (orgId, domainId?, projectId?, teamId?) on all writes; IDs incorporate scope.
- Idempotent by `(endpointId, source_event_id)`; retries safe.
- Rate-limit/backoff must be observable via run stats.

## Acceptance Mapping
- AC1 → Capabilities matrix + emits patterns.
- AC2 → CDM field mapping tables & identities.
- AC3 → Ingestion contract (listUnits/syncUnit/checkpoint/backoff) per source.
- AC4 → Signal types enumerated with examples & idempotency.
- AC5 → KB upsert mapping & vector profiles.
- AC6 → GraphQL ingestion management surfaces (args & shapes) defined.

## Risks / Open Questions
- R1: OneDrive webhook support varies; baseline on polling + delta tokens.
- R2: Confluence body formats (storage vs view) require consistent text extraction rules.
- R3: Jira custom fields explosion—scope CDM to portable core; allow passthrough `attributes`.
- Q1: Do we require per‑unit parallelism controls (max concurrent units) in the contract?
- Q2: Minimum viable “stats” set for run UIs (counts, durations, top errors) — propose a small standard.
```

---

