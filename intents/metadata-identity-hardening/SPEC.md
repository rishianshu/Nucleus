intents/metadata-identity-hardening/SPEC.md

# SPEC — Metadata & graph identity hardening

## Problem
Currently, metadata and graph entities often share a weak/naive identity:
- Metadata records are created with IDs that may be:
  - user-provided,
  - random UUIDs (e.g. `${endpoint.id}-${uuid}`),
  - or simple table names.
- Graph entities are created using those same IDs and sometimes simple names as `canonicalPath`.

This leads to:
- Collisions across endpoints (e.g. two `public.users` tables from different endpoints sharing the same graph identity).
- Unstable identity (repeated collections might change the ID).
- GraphStore and MetadataStore both “owning” identity in an ad-hoc way.

We need a **canonical, deterministic identity scheme** so that:
- Each dataset (e.g. catalog.dataset) has a stable metadata record ID.
- Graph entities have stable `(entityType, id, canonicalPath)`.
- Repeated collections update the same entities and never collide across endpoints.

## Interfaces / Contracts

### Canonical identity model

For the `catalog.dataset` domain, identities must be derived from:

- Tenant: `tenantId` (from context)
- Project: `projectId` (from metadata record)
- Endpoint: `sourceId` or endpoint.id
- Dataset path: typically `schema.table` (and possibly database name)

**Canonical dataset key (conceptual):**

```ts
interface DatasetKey {
  tenantId: string;       // e.g. "dev"
  projectId: string;      // e.g. "global"
  sourceId: string;       // stable endpoint/source identifier
  database?: string;      // optional
  schema: string;         // e.g. "public"
  table: string;          // e.g. "users"
}

From DatasetKey, we derive:
	•	Metadata record ID, e.g.:

dataset::<tenantId>::<projectId>::<sourceId>::<schema>::<table>

(normalized and lowercased, with reserved characters encoded)

	•	Graph entity ID + canonicalPath, e.g.:

id:           dataset::<tenantId>::<projectId>::<sourceId>::<schema>::<table>
canonicalPath: <sourceId>/<schema>/<table>
entityType:   "catalog.dataset"



MetadataStore contract
	•	MetadataStore remains responsible for upsertRecord({ id, projectId, domain, labels, payload }).
	•	For catalog.dataset domain:
	•	id MUST be deterministic for a given DatasetKey.
	•	Upserts MUST respect that identity (same dataset key always hits the same record).

GraphStore contract
	•	GraphStore receives only normalized metadata records.
	•	syncRecordToGraph will:
	•	Determine if record.domain == "catalog.dataset".
	•	Build entity identity using the canonical dataset key (not just record.id or simple name).
	•	Upsert a single graph entity per dataset key.
	•	GraphStore MUST NOT invent its own IDs for catalog datasets; it uses the canonical scheme.

Backward compatibility
	•	Existing records with legacy IDs must continue to be readable.
	•	The new identity scheme applies to:
	•	new records ingested after the change,
	•	optionally, migrated legacy records (if we run a backfill).

If a migration is implemented, it must:
	•	map old records to the new canonical ID,
	•	update related graph entities accordingly,
	•	be idempotent.

Data & State

MetadataRecord

No schema change required, but semantic changes:
	•	A dataset record’s id must be stable for a given dataset key.
	•	labels already include:
	•	endpoint:<endpointId>
	•	and source:<sourceId> if present.

persistCatalogRecords must:
	•	Compute the dataset key from:
	•	run.endpoint.projectId,
	•	run.endpoint.sourceId or fallback,
	•	dataset payload (schema/table/database),
	•	Compute deterministic id from dataset key,
	•	Call store.upsertRecord({ id, projectId, domain, labels, payload }).

Graph entities

syncRecordToGraph currently:
	•	Only acts on record.domain === "catalog.dataset".
	•	Uses record.id and payload to derive displayName and canonicalPath.

After change, syncRecordToGraph must:
	•	Treat record.id as the canonical metadata ID (following the new scheme).
	•	Ensure canonicalPath derives from dataset key as well (e.g. <sourceId>/<schema>/<table>).
	•	Upsert a single entity for that (entityType, id).

Constraints
	•	Identity derivation must be:
	•	deterministic (same dataset key → same ID),
	•	reversible enough to debug (easy to see which endpoint/schema/table it refers to),
	•	safe (no secrets included).
	•	Performance:
	•	ID construction must be cheap (string concatenation and normalization only).
	•	Queries against records/entities must remain performant (indexes on ID, labels as needed).
	•	This SPEC focuses on catalog.dataset first; other domains (graph.entity, etc.) can adopt similar conventions later.

Acceptance Mapping
	•	AC1 → tests with two endpoints producing same simple table name but distinct dataset keys (different sourceIds); they must get unique record & entity IDs.
	•	AC2 → tests for repeated collections of the same endpoint/dataset; they must update the same record/entity ID.
	•	AC3 → tests for legacy records and graph entities being readable and not broken by the new ID logic.
	•	AC4 → static analysis / tests verifying that GraphStore and MetadataStore are only used via canonical identity paths in ingestion (no ad-hoc ID generation in workflows).

Risks / Open Questions
	•	R1: Legacy records with random IDs will coexist with new canonical IDs (two records for effectively the same dataset). Mitigation: optional backfill/migration slug.
	•	R2: If sourceId or schema/table are missing or malformed in payload, ID derivation may fail. We must define fallback behavior (e.g. reject record with explicit error, or place it under a safe “unknown” namespace).
	•	Q1: Should we backfill existing records now or only apply the new scheme to new ingest? (For this slug, default is “apply to new ingest; migration optional but recommended later.”)
	•	Q2: How to handle database renames or endpoint renames? (Potential follow-up: aliasing or redirect metadata, out of scope here.)

---

