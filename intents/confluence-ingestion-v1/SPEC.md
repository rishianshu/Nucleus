# SPEC — Confluence ingestion v1

## Problem

We now have:

- Confluence as a semantic HTTP endpoint (metadata + catalog + preview).
- A docs CDM (`CdmDocSpace`, `CdmDocItem`, `CdmDocRevision`, `CdmDocLink`) and mapping helpers.
- Ingestion core (GraphQL + Temporal + KV) and CDM sinks (already exercised with Jira/work).

But:

- There are no **Confluence ingestion units**.
- The ingestion UI cannot configure Confluence source → sink flows.
- We don’t ingest page/attachment content into any sink or into docs CDM.

We need a minimal but complete Confluence ingestion story:

- Confluence-specific ingestion units derived from metadata/catalog.
- Configurable source → sink flows in raw + CDM modes.
- Basic incremental ingestion per space (using updatedAt watermarks).
- Source → Staging → Sink wiring reusing existing ingestion core.

## Interfaces / Contracts

### 1. Confluence ingestion units

We reuse the ingestion unit model introduced for Jira:

- `IngestionUnit` (TS / GraphQL) with:
  - `id`
  - `sourceEndpointId`
  - `sinkEndpointId`
  - `mode: "raw" | "cdm"`
  - `templateId` (ties to endpoint template)
  - `datasetDomain` / `unitType` (e.g. `"confluence.page"`)
  - `config` (JSON blob, typed per template)

For Confluence we add units (conceptually):

- `confluence.docs.page` — ingest page content.
- `confluence.docs.attachment` — ingest attachments (optional v1).

`config` for Confluence units:

```ts
export interface ConfluenceIngestionFilter {
  spaceKeys?: string[];      // restrict to given spaces
  updatedFrom?: string|null; // ISO timestamp; default null (full history)
}

export interface ConfluenceIngestionUnitConfig {
  filter?: ConfluenceIngestionFilter;
  pageSize?: number;         // API page size (sane default)
}

The GraphQL ingestion schema must:
	•	Expose these configs for units whose templateId is http.confluence.
	•	Enforce that only Confluence units accept ConfluenceIngestionUnitConfig.

2. Planner / strategy behavior (high-level)

For Confluence units, the ingestion planner/strategy should:
	•	Read:
	•	unit config (filter),
	•	Confluence metadata (spaces) from catalog/metadata,
	•	existing KV watermarks (per space).
	•	Plan segments of work, where each segment is:

Segment = {
  unitId,
  spaceKey,
  range: [fromUpdatedAt, toUpdatedAt?) // for now, "to" can be "now"
}



Basic rules:
	•	For each spaceKey in filter:
	•	Determine from:
	•	If watermark exists for that space: use it.
	•	Else if updatedFrom provided: use that.
	•	Else: None (full history).
	•	For v1, we can use a single open-ended window [from, now) per space per run.

Segments are passed to the Python ingestion worker.

3. Python worker: Confluence ingestion handlers

Add handlers in the ingestion worker (Python) to execute segments:

def ingest_confluence_pages_segment(
    endpoint_cfg: dict,
    segment: ConfluenceSegment,
    mode: str,        # "raw" or "cdm"
    staging: StagingSink,
    stats: IngestionStats,
) -> None:
    ...

Responsibilities:
	•	Use Confluence endpoint (from runtime_common.endpoints) to:
	•	Page through /rest/api/content (or equivalent) with:
	•	spaceKey,
	•	type=page,
	•	updated >= fromUpdatedAt if present,
	•	pagination (start, limit).
	•	For each page record:
	•	In raw mode:
	•	Normalize into a “raw Confluence page record” envelope suitable for sinks.
	•	In cdm mode:
	•	Build CdmDocSpace / CdmDocItem / CdmDocRevision using the Confluence→CDM mappers.
	•	Emit one or more CDM docs records into staging.

Staging → sink:
	•	Existing ingestion core ensures:
	•	Staging collects records emitted by the handler (e.g. in Arrow/Avro or row-wise envelope).
	•	Sink endpoint (e.g. CDM docs sink) consumes from staging and persists records.

KV watermarks:
	•	After successful segment execution:
	•	Update lastUpdatedAt for that spaceKey based on the max updated timestamp seen.

4. Mode: raw vs CDM

We reuse the CDM mode semantics defined earlier:
	•	If mode = "raw":
	•	Handler emits records shaped like “raw Confluence pages” (or attachments).
	•	Sink can be any ingestion sink endpoint (JDBC, Minio, etc.).
	•	If mode = "cdm":
	•	Handler maps to docs CDM using the Confluence mappers from cdm-docs-model-and-semantic-binding-v1.
	•	Sink is expected to be a CDM-aware sink (e.g. CDM docs Postgres sink).
	•	cdm_model_id for Confluence page unit should be something like "cdm.doc.item" and/or "cdm.doc.revision".

The ingestion planner should enforce:
	•	If mode="cdm":
	•	Only allow sink endpoints that support the docs CDM model id.
	•	If mismatched:
	•	Reject config with clear error.

5. UI integration

Ingestion UI:
	•	When a user selects a Confluence endpoint as source:
	•	Show Confluence units, e.g. “Confluence pages”.
	•	Allow choosing:
	•	sink endpoint,
	•	mode (raw vs CDM),
	•	filter:
	•	space keys (multiselect from Confluence metadata),
	•	updatedFrom (optional datetime).
	•	Save config as ConfluenceIngestionUnitConfig.

UI can reuse the metadata-driven dropdown pattern used for Jira (projects/users/statuses), here using:
	•	Confluence spaces metadata dataset for spaceKeys.

We don’t need a big dedicated Confluence ingestion screen; reuse generic ingestion configuration panels.

Data & State
	•	New ingestion units for Confluence (TS/GraphQL).
	•	New KV entries for per-space watermarks, reusing existing ingestion state store.
	•	Staging & sinks are reused; no new DB tables beyond what CDM sinks already defined.

No changes to metadata/circuit outside ingestion.

Constraints
	•	Planner behavior should be simple but correct; we defer volume-aware slicing to a later global ingestion refinement slug.
	•	Full run must be idempotent; re-running a segment should not create duplicates in CDM sinks (handled by sink or by upsert semantics).

Acceptance Mapping
	•	AC1 → ingestion units & config for Confluence exist and are wired to UI.
	•	AC2 → raw mode ingestion works and writes to a sink.
	•	AC3 → CDM mode ingestion maps to docs CDM and writes to CDM sink.
	•	AC4 → per-space incremental behavior using updatedAt watermarks.

Risks / Open Questions
	•	R1: Very large spaces may require time-based partitioning instead of single [from, now); v1 accepts larger runs with the option to refine later.
	•	Q1: Exact mapping of page versions to CdmDocRevision (e.g. ingest all versions vs only latest); v1 can ingest latest revision only and leave full revision history to a later slug.
