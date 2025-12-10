# Core Stores

This note defines Nucleus' core storage interfaces and boundaries for all runtimes (TypeScript, Python, Go/UCL). Stores are language-agnostic contracts; callers should depend on these interfaces rather than direct DB/filesystem access so backends can change without API drift.

## Store Catalog

| Store | Responsibilities | Primary Clients | Default Backend | Notes |
| --- | --- | --- | --- | --- |
| MetadataStore | Catalog metadata, endpoint descriptors/configs, collection + ingestion state mirrored to Prisma. | Metadata service/collectors, GraphQL resolvers, Metadata/Workspace UI. | Postgres/Prisma (file dev fallback). | System of record for catalog + endpoint registry; not for blobs. |
| GraphStore | Knowledge graph nodes/edges (work/docs/identity/access/scope), provenance. | Brain/KB GraphQL, ingestion KB sink, signals, Workspace explorers. | Postgres tables via MetadataStore adapter (file dev fallback). | Semantic graph only; bulk data stays in sinks/ObjectStore. |
| SignalStore | SignalDefinition + SignalInstance state, evaluations, schedules. | Signal evaluators/cron, Brain API, UI surfaces that list signals + runs. | Postgres/Prisma. | Separate from SignalBus/event fanout; stores durable signal state. |
| KvStore | Small JSON state scoped by namespace + scopeId (checkpoints, transient state, feature flags). | Temporal workflows, UCL connectors, ingestion workers, control-plane services. | **DB-backed table** (`kv_entries`); replaces file-backed `metadata/kv-store.json`. | Optimistic concurrency via `version`; not for large payloads. |
| ObjectStore | Large/binary objects and staging artifacts (Git archives, doc snapshots, ingestion chunks). | UCL connectors, ingestion runtime, KB/Workspace attachments, Git endpoints. | S3-compatible bucket (S3/MinIO) with local filesystem fallback for dev. | Streaming read/write; callers pass `{bucket, key}` references through workflows. |

## KvStore Contract

**Interface (language-agnostic):**

```ts
interface KvStore {
  get(namespace: string, scopeId: string, key: string): Promise<KvEntry | null>;
  put(entry: KvEntry): Promise<void>;
  delete(namespace: string, scopeId: string, key: string): Promise<void>;
  list(namespace: string, scopeId: string, prefix?: string, limit?: number): Promise<KvEntry[]>;
}

interface KvEntry {
  namespace: string;      // e.g., "ingestion", "ucl", "signals"
  scopeId: string;        // workspace/project/endpoint/run identifier
  key: string;            // logical key within the scope
  value: any;             // JSON-serializable
  version: number;        // monotonically increasing
  updatedAt: string;      // ISO timestamp
}
```

**Semantics**
- `put` upserts an entry, bumps `version`, and is idempotent under retries (same payload + scope produces the same logical state).
- `get` is strongly consistent within the DB instance; callers should supply `expectedVersion` for optimistic concurrency where supported.
- `list` supports scanning checkpoints for a given `{namespace, scopeId}` with optional `prefix` and `limit`.
- Scope is multi-tenant: `scopeId` carries workspace/project/endpoint IDs so one DB table can host all tenants safely.

**DB schema (conceptual)**
- Table: `kv_entries` with columns `namespace` (text), `scope_id` (text), `key` (text), `value` (JSONB), `version` (integer), `updated_at` (timestamptz).
- Primary key on `(namespace, scope_id, key)`; secondary index on `(namespace, scope_id)` for scans.
- Default ordering by `updated_at DESC` for `list` to enable "latest first" enumerations.

**Migration from file-backed KV**
- Current default (`packages/metadata-core` → `metadata/kv-store.json`, configurable via `INGESTION_KV_FILE`) must be migrated to the DB table above.
- Two supported paths:
  - **Import:** run a one-time script that reads the existing JSON map and inserts rows with `version=1` and `updated_at=now()`, preserving keys under the same namespaces (e.g., `ingest::<vendor>::endpoint::<endpointId>::unit::<unitId>::sink::<sinkId?>`).
  - **Reset (dev-only):** if the environment uses KV purely for ephemeral checkpoints, wipe the file and start empty in `kv_entries`.
- Until runtime code is updated, keep the file driver as a compatibility fallback, but new deployments should point `KV_STORE_DRIVER=db` (or equivalent) at the database table.

## ObjectStore Contract

**Interface:**

```ts
interface ObjectStore {
  putObject(req: PutObjectRequest): Promise<PutObjectResult>;
  getObject(req: GetObjectRequest): Promise<ReadableStream<Uint8Array>>;
  deleteObject(req: DeleteObjectRequest): Promise<void>;
  listObjects(req: ListObjectsRequest): Promise<ObjectSummary[]>;
}

interface PutObjectRequest {
  bucket: string;
  key: string;
  contentType?: string;
  metadata?: Record<string, string>;
  // data provided as a stream per language/runtime
}

interface PutObjectResult {
  bucket: string;
  key: string;
  size: number;
  etag?: string;
}

interface GetObjectRequest {
  bucket: string;
  key: string;
  range?: { start: number; end?: number };
}

interface DeleteObjectRequest {
  bucket: string;
  key: string;
}

interface ListObjectsRequest {
  bucket: string;
  prefix?: string;
  limit?: number;
}

interface ObjectSummary {
  bucket: string;
  key: string;
  size: number;
  contentType?: string;
  metadata?: Record<string, string>;
  lastModified?: string;
}
```

**Semantics**
- **Streaming first:** `putObject` and `getObject` accept/return streams so large payloads never transit Temporal payloads or memory. Callers pass `{bucket, key}` references through workflows/GraphQL instead of raw bytes.
- **Idempotency via addressing:** deterministic keys (e.g., `ingestion/<endpointId>/<runId>/<slice>.parquet` or `git/<repoId>/<commit>.tar.gz`) keep writes repeatable.
- **Metadata:** optional `contentType` + key/value metadata travel with each object for downstream sinks or audit trails.
- **Range reads:** optional byte ranges allow partial fetches for large archives.

**Backends**
- **S3-compatible** (MinIO, AWS S3) as the primary backend, supporting buckets, versioned objects, and presigned URL access when needed by UI/UCL.
- **Local filesystem** for development/tests (mirrors S3 semantics where possible, storing objects under a configured root directory).

## Access Patterns & Boundaries

- **MetadataStore** remains the source of truth for catalog + endpoint registry; GraphQL/Workspace read through this interface rather than Prisma tables directly.
- **GraphStore** backs all KB/semantic views; ingestion KB sinks and Brain APIs upsert nodes/edges via the interface to preserve scope-aware identity.
- **SignalStore** holds signal definitions/instances; SignalBus/eventing is out-of-scope and handled by separate messaging infrastructure.
- **KvStore** replaces file-backed checkpoints for Temporal/UCL/ingestion; only small JSON state should live here (no binaries or large manifests).
- **ObjectStore** is the sole staging/raw artifact store for ingestion and Git/Doc blobs; Temporal activities and UCL connectors exchange `{bucket, key}` pointers instead of embedding payloads.
- Brain API and Workspace surfaces should cite these store interfaces (not Postgres tables or local files) when describing persistence or data flow so language-agnostic clients stay aligned.

