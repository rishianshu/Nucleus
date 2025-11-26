intents/semantic-jira-source-v1/SPEC.md

# SPEC — Semantic Jira source v1

## Problem

The ingestion plane (GraphQL → Temporal → ingestion core → KB) is wired but uses only a static driver and a KB sink; there is no real source producing ingestion units. The Ingestion UI lists endpoints but shows “No ingestion units yet” for all of them. We need Jira to be the first semantic-aware source that:

- Exposes ingestion units (projects, issues, users) to the console.
- Runs incrementally using checkpoints.
- Lands connected metadata into the Knowledge Base (KB) graph so downstream apps can reason about work items.

**Metadata-first constraint.** All ingestion in Nucleus is metadata driven: endpoints must be registered, their datasets must be catalogued, and the ingestion units must be derived from those published datasets. Ingestion **does not** invent sources that the metadata plane has never seen. This spec now requires the Jira metadata subsystem to emit CatalogSnapshots so the catalog lists Jira datasets; only then are ingestion units enabled for the same endpoint/dataset pair.

**KB scope.** The KB remains a knowledge surface for semantic entities (projects, issues, users, etc.). It is *not* a bulk data repository. Ingestion batches may publish normalized KB nodes/edges for reasoning, but the row-level data itself will surface in a future “ingested data” view (e.g., dataset detail’s run history). The Jira work in this slug should therefore treat KB writes as enrichment metadata and keep that boundary clear in docs/tests.

## Interfaces / Contracts

### 1. Jira SourceEndpoint descriptor (Python)

Add a Jira endpoint template under `runtime_common/endpoints` (e.g. `jira_http.py`), registered in `registry.py`. 

**Descriptor:**

- `id`: `jira.http`
- `family`: `http`
- `vendor`: `jira`
- Fields (descriptor_fields):
  - `base_url` (STRING, required) – Jira Cloud or Server base URL.
  - `auth_type` (ENUM: `basic`, `pat`, `oauth`).
  - `username` (STRING, visible when `auth_type=basic`).
  - `api_token` / `password` (PASSWORD, required for `basic`/`pat`).
  - `project_keys` (STRING, optional; comma-separated project keys to target).
  - `jql_filter` (STRING, optional; additional JQL applied to issues).
- Capabilities (descriptor_capabilities):
  - `metadata.collect` (optional future use for Jira metadata).
  - `ingest.incremental` – Jira supports incremental ingestion via `updated >= <timestamp>`.
  - `ingest.full` – allowed but should be guarded (time-bounded).
- Extras:
  - Publish the REST API surface (method/path/docs/scope) so MetadataWorkspace can show what Jira endpoints are exercised.
  - Publish the canonical ingestion units derived from the dataset catalog (projects/issues/users) so the TypeScript driver can list units generically without Jira-specific logic.

The endpoint implements the existing SourceEndpoint protocol and uses an HTTP client/tool from `runtime_common/tools` for REST calls.

### 2. Jira ingestion units

We define **code-generated units**, not user-configured units.

Per endpoint, `listUnits(endpointId)` (exposed via the ingestion core) returns descriptors like:

```ts
type IngestionUnitDescriptor = {
  unitId: string;     // e.g. "jira.projects", "jira.issues"
  kind: "semantic";   // using existing 'kind' from metadata-core
  displayName: string;
  stats?: IngestionUnitStats;
};

Units for v1:
	1.	jira.projects
	•	Scope: projects visible to the configured credentials, optionally filtered by project_keys.
	•	Purpose: seed KB with project nodes and basic fields (key, name, lead, type).
	2.	jira.issues
	•	Scope: issues in the selected projects, filtered by JQL + incremental window.
	•	Purpose: populate KB with work items linked to projects and users.
	3.	(Optional) jira.users
	•	Scope: users referenced by issues (assignee, reporter).
	•	Purpose: enrich KB graph with person nodes.

The ingestion-core ingestionUnits GraphQL query exposes these descriptors for a Jira endpoint; the Ingestion console renders them in the right-hand panel. **Units must map 1:1 with catalog datasets.** When the metadata subsystem inserts `catalog.dataset` records for Jira (projects/issues/users), the same dataset IDs/policies are reused for ingestion units. If an endpoint has not run metadata collection yet, the API should return zero units (and the UI should show the empty state) to reinforce the metadata-first contract.

Units are derived from the same dataset catalog defined in Python (`jira_catalog.py`). Any dataset that marks `ingestion.enabled=true` automatically surfaces as a unit in descriptor extras, metadata snapshots, and ingestion. The TS ingestion driver simply reads those extras; no Jira-specific TypeScript is required.

### 3. Ingestion data-plane for Jira

We follow the Source → Staging → Sink shape at the Python layer, but for v1 the final sink is KB (graph metadata).

Python ingestion worker entrypoint (conceptually):

def run_jira_ingestion_unit(
    endpoint_id: str,
    unit_id: str,
    checkpoint: dict | None,
    policy: dict,
) -> dict:
    """
    - Resolves Jira SourceEndpoint via registry.
    - Creates an in-memory staging session (rows kept as Python dicts or Arrow).
    - Runs source-specific export logic:
      - projects: GET /rest/api/3/project/search
      - issues: GET /rest/api/3/search with JQL and updated>=checkpoint
    - For each page, writes normalized records into staging.
    - Flushes staging to KB by calling a KB writer helper.
    - Returns { newCheckpoint, stats, errors } to the TS ingestion core.
    """

Checkpoint shape:
	•	For jira.projects: last sync timestamp, or a monotonically increasing “generation” to support re-sync.
	•	For jira.issues: { lastUpdated: ISO8601 } based on Jira’s fields.updated or fields.resolutiondate.

KB writer helper:

Implement a small helper in the ingestion worker (or a shared Python library) that transforms Jira entities into KB nodes/edges:
	•	Node types (examples):
	•	work.item (one per issue).
	•	work.project (one per project).
	•	person.user (optional, per user).
	•	Edges:
	•	BELONGS_TO (issue → project).
	•	ASSIGNED_TO / REPORTED_BY (issue → user).
	•	Logical keys:
	•	jira::<host>::project::<key>
	•	jira::<host>::issue::<issue_key>
	•	jira::<host>::user::<account_id>

KB writes can use the existing GraphStore API (HTTP/GraphQL) or a DB helper, but must be idempotent: rerunning a unit with the same checkpoint must not duplicate nodes. KB writes are for semantic insights only; bulk issue/project payloads remain in staging or the forthcoming ingestion-data view.

TypeScript ingestion core treats Jira like any other unit:
	•	ingestionRunWorkflow launches a Temporal activity that calls the Python worker, receives { newCheckpoint, stats }, and updates KV + IngestionUnitState.

### 4. GraphQL & UI behavior

No new GraphQL types are required; we reuse existing ingestion types:  ￼
	•	ingestionUnits(endpointId) must return the new Jira units when the endpoint’s template ID starts with jira..
	•	startIngestion(endpointId, unitId) must:
	•	validate that unitId is a known Jira unit,
	•	schedule Temporal ingestionRunWorkflow for that unit.

In the Ingestion console:
	•	Selecting a Jira endpoint should show jira.projects, jira.issues (and optionally jira.users) in the unit list.
	•	Running a unit should update status chips (QUEUED/RUNNING/SUCCEEDED/FAILED) and show the last run time, per the existing ingestion-core UI patterns.

In the KB Admin console:
	•	After a successful run, nodes of the types above must appear in the Nodes tab, filterable by type (work.item, work.project, etc.), and the Overview statistics should reflect the increased counts.  ￼

## Catalog integration & interim UI

Until a dedicated ingestion-data explorer ships, the dataset detail drawer should surface the latest ingestion stats/checkpoint for any unit derived from that dataset. This lets users confirm “metadata describes the dataset” and “ingestion is populating downstream stores” without conflating catalog rows with KB entities. Future slugs will add a proper ingested-data view; the Jira spec only needs to ensure the APIs expose the stats for the dataset detail to consume later.

## Data & State
	•	IngestionUnitState remains the authoritative DB state for units; no schema changes.
	•	Jira checkpoints are stored in KV using the existing { endpointId, unitId } keying scheme; the value includes cursor (e.g. lastUpdated) and stats.  ￼
	•	KB additions from Jira are standard nodes/edges stored in the existing graph tables **for semantic graphing only**.

Constraints
	•	Jira API auth must rely on fields provided by the endpoint descriptor; no hidden environment variables.
	•	For v1, it is acceptable to ingest a limited subset of Jira fields needed for KB nodes; full CDM shape can evolve later.
	•	Performance: endpoints are expected to work with modest Jira projects; we can add backoff and page limits to avoid huge one-shot syncs.

Acceptance Mapping
	•	AC1 → Jira endpoint descriptor exists and appears in UI; config values flow into MetadataEndpoint.config.
	•	AC2 → ingestionUnits(endpointId) returns Jira units for Jira endpoints; Ingestion UI displays them for at least one seeded Jira endpoint.
	•	AC3 → startIngestion for Jira units runs through Temporal, updates KV + IngestionUnitState, and produces SUCCEEDED or FAILED statuses with stats.
	•	AC4 → KB nodes/edges created from Jira are visible in KB Admin console and can be located by type and/or logical key.

Risks / Open Questions
	•	R1: Jira API rate limits; v1 may need conservative concurrency/page sizes.
	•	R2: Mapping Jira entities into a generic CDM (work.item, person.user, etc.) must be stable enough to avoid churn in KB identity.
	•	Q1: For multi-tenant deployments, how should scopes (project/domain/team) be encoded in Jira KB nodes to avoid collisions across tenants?

---
