# SPEC — Semantic OneDrive source v1

## Problem

We now have:

- A unified ingestion pipeline (adaptive planner → Source → Staging → Sink).
- Semantic sources for Jira (work) and Confluence (docs) wired into CDM Work and CDM Docs.
- A CDM Docs Explorer that can show docs CDM entities by dataset/source.

However, OneDrive — a critical docs source — is missing:

- No endpoint template in the registry/CLI.
- No metadata subsystem to emit datasets for OneDrive docs.
- No ingestion units/strategy to pull OneDrive docs and map them into the docs CDM.
- No presence of OneDrive docs in the CDM Docs Explorer.

We need OneDrive to behave like a first-class semantic docs source.

## Interfaces / Contracts

### 1. Endpoint descriptor (Python registry)

Add a OneDrive descriptor in `runtime_common.endpoints` (e.g., `onedrive_http.py`) and register it in the endpoint registry:

- `id`: `http.onedrive`
- `family`: `onedrive`
- `title`: “OneDrive”
- `domain`: `docs` (or equivalent)
- `capabilities`:
  - `metadata` (exposes datasets/files),
  - `preview` (preview for text docs where reasonable),
  - `ingestion` (supports ingestion units and slices).

Descriptor fields (example):

- `tenant_id` (string, required, sensitive? -> no, but access token is),
- `client_id` (string, required, sensitive),
- `client_secret` (password, required, sensitive),
- `drive_selector` (enum / string; e.g., `me`, `shared`, explicit drive id),
- `root_path` (string; default `/`, optional),
- `include_file_types` (string or multiselect; e.g., `docx,md,txt,pdf`),
- `exclude_patterns` (string; optional glob/regex).

`test_connection`:

- Performs a small Graph API call (e.g., list drives or list items under `root_path`).
- Returns:
  - `success`: bool,
  - `message`,
  - `detectedVersion` (optional),
  - `capabilities` list (e.g., `["METADATA", "PREVIEW", "INGESTION"]`).

### 2. Metadata subsystem (catalog datasets)

Implement a OneDrive metadata subsystem that:

- Uses the endpoint config to:
  - Resolve the target drive/root (e.g., `drives/{drive-id}/root:/root_path:`).
  - Enumerate folders/files under that root (bounded by pagination; may be a partial view in v1).

- Emits catalog datasets (e.g., `MetadataRecord` domain `catalog.dataset` entries) for:

  - “OneDrive Files — <endpoint label> — <path scope>” as one dataset, or
  - Multiple datasets per logical grouping (e.g., per top-level folder or “library”).

At minimum for v1:

- Create **one dataset per endpoint** representing the configured root, with:
  - `domain = "catalog.dataset"`,
  - `labels` including `onedrive`, `docs`,
  - payload describing:
    - logical name (`onedrive.<endpoint_slug>.docs`),
    - CDM docs binding (for ingestion),
    - file type filters,
    - root path.

Metadata collection runs:

- Created and surfaced through the existing collections UI.
- After a successful run, the Catalog view should show the OneDrive dataset(s).

### 3. Ingestion units and adaptive planning

Define an ingestion unit for OneDrive docs, discovered via the metadata subsystem:

- Each OneDrive docs dataset produces one **ingestion unit** for docs.

Planner (Python, using the unified interface):

```python
class OneDriveEndpoint(..., SupportsIngestionUnits, SupportsIncrementalPlanning):
    ...

	•	list_units(...):
	•	Returns EndpointUnitDescriptor for the docs dataset(s), including:
	•	unit_id,
	•	dataset_key,
	•	domain (docs),
	•	CDM model id (e.g., cdm.docs.item),
	•	incremental field (e.g., lastModifiedDateTime).
	•	plan_incremental_slices(...):
	•	Uses the KV checkpoint (per endpoint/unit) to determine a lastModified watermark.
	•	For v1, plan slices as:
	•	Time windows (e.g., “lastModified > watermark AND <= watermark + Δt”) or
	•	Offset/limit pages under the root if time windows are not reliable.
	•	Ensure each slice:
	•	handles a bounded number of files (e.g., ~100–500 per slice),
	•	includes enough parameters for the worker to reconstruct the Graph API calls.

Slices must be consistent with the unified IngestionPlan / IngestionSlice structures introduced in the ingestion unification slug.

4. Source → Staging → Sink implementation (OneDrive docs)

Python worker behavior per slice:
	1.	Construct OneDrive SourceEndpoint from endpoint config.
	2.	Call read_slice(unit, slice):
	•	Iterate OneDrive items (files) in that slice.
	•	For each file:
	•	Fetch metadata and, where feasible, a small content snippet/preview (e.g., for text/markdown; for large/binary types, only metadata is required).
	•	Normalize into a NormalizedRecord doc shape suitable for CDM mapping (fields like title, path, mime type, modifiedAt, size, etc.).
	3.	Open a StagingSession for the slice (using the configured staging provider).
	4.	Stream NormalizedRecord batches into staging_session.writer().write_batch(...).
	5.	Close the session and return to Temporal:
	•	slice_key,
	•	new_checkpoint (e.g., max lastModifiedDateTime seen),
	•	stats (rows, bytes, times),
	•	staging handle, not the records.

Sink:
	•	The CDM docs sink / generic sink reads from staging:
	•	Rebuilds StagingSession from the handle.
	•	Reads batches via reader().iter_batches(...).
	•	If ingestion mode is cdm, pipes records through the docs CDM mapper (via the CDM registry) before writing to CDM tables.
	•	If ingestion mode is raw, writes a raw representation to a configured raw sink.

5. CDM integration and explorer

CDM docs mapper:
	•	Reuse the existing docs CDM model and mapping contract.
	•	Add a OneDrive mapper registered via the CDM registry (e.g., endpoint="http.onedrive", unit_id="onedrive.docs").

The mapper:
	•	Translates NormalizedRecord fields into CDM docs fields:
	•	title, project/workspace (e.g., drive or logical group), path, type (file extension/mime), last updated, size, sourceSystem=onedrive, etc.

CDM Docs Explorer:
	•	Once docs CDM sink has OneDrive docs, the existing Docs tab should:
	•	Show OneDrive datasets via cdmDocsDatasets,
	•	Allow filtering by OneDrive datasets,
	•	Show OneDrive docs rows with correct Source (OneDrive) and Dataset labels,
	•	Provide “Open in source” links (drive/file URL) in the detail pane.

The explorer does not require schema changes if it already consumes generic docs CDM entities and dataset metadata; it just needs OneDrive docs to be present in the sink.

Data & State
	•	Metadata:
	•	New MetadataRecord entries for OneDrive datasets (domain catalog.dataset).
	•	KV state:
	•	Per endpoint/unit checkpoint keyed like ingest::onedrive::endpoint::<endpointId>::unit::<unitId>.
	•	Stores at least lastModified watermark and any paging cursors if needed.
	•	CDM docs sink:
	•	Receives CDM docs rows from the sink path; stored alongside Confluence docs.

Constraints
	•	No bulk data (file content) may be passed via Temporal payloads; only staging handles and stats.
	•	To keep v1 manageable:
	•	Only support a subset of file types for previews (e.g., text/markdown); others can expose metadata-only.
	•	Authentication:
	•	Use OAuth/Graph client credentials or similar, wired through endpoint config; no one-off auth flows inside the workflow.

Acceptance Mapping
	•	AC1 → Endpoint template and test_connection.
	•	AC2 → Metadata collection emits OneDrive datasets in catalog.
	•	AC3 → Ingestion units and planner yield slices and run via Source → Staging → Sink.
	•	AC4 → CDM Docs Explorer shows OneDrive docs and detail view.
	•	AC5 → Metadata-driven invariant enforced for OneDrive; no ingestion without catalog datasets.
	•	AC6 → ci-check passes.

Risks / Open Questions
	•	R1: OneDrive API limits and throttling; planners must keep slice sizes reasonable and rely on retries.
	•	R2: Handling very large files; v1 will limit content reading to small text-like docs, with later slugs handling more advanced extraction/previews.
	•	Q1: How many datasets per endpoint? v1 uses a single docs dataset per endpoint root; later we can split per folder or share.
