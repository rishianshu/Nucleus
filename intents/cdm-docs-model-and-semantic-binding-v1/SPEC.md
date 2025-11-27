# SPEC — CDM docs model & semantic binding v1

## Problem

Nucleus now understands **work** semantically via the work CDM, and we have a working ingestion pipeline (planner + filters + KV) for Jira. The next semantic sources—Confluence and OneDrive—represent **knowledge** in the form of documents:

- Confluence: spaces, pages, attachments, internal links.
- OneDrive: drives, folders, files, versions, sharing links.

We lack a unified **documents CDM** to normalize these into a single semantic shape that downstream apps (Workspace, search, signals, KB) can consume.

We need:

- A source-agnostic CDM for **doc spaces, items, revisions, links**.
- Deterministic ID patterns and relationships.
- Pure mapping functions from Confluence/OneDrive to CDM docs.
- Clear docs for how this ties into ingestion planner + sinks in later slugs.

This slug does *not* implement sinks or ingestion units; it only defines models + mappings + architecture docs.

## Interfaces / Contracts

### 1. CDM docs model (Python)

Create module:

- `runtime_core/cdm/docs.py`

Use dataclasses/pydantic (matching your existing work CDM style).

#### 1.1. `CdmDocSpace`

Logical container (Confluence space, OneDrive drive/site).

Fields:

- `cdm_id: str`  
  - e.g. `cdm:doc:space:confluence:SPACEKEY`, `cdm:doc:space:onedrive:<driveId>`
- `source_system: str`  # "confluence", "onedrive", etc.
- `source_space_id: str`
- `key: Optional[str]`  # Confluence space key, drive name, etc.
- `name: str`
- `description: Optional[str]`
- `url: Optional[str]`
- `properties: Dict[str, Any]`  # source-specific extras

#### 1.2. `CdmDocItem`

Represent a document (page/file).

- `cdm_id: str`  
  - e.g. `cdm:doc:item:confluence:<pageId>`, `cdm:doc:item:onedrive:<driveId>:<itemId>`
- `source_system: str`
- `source_item_id: str`
- `space_cdm_id: str`          # FK to CdmDocSpace
- `parent_item_cdm_id: Optional[str]`  # parent page/folder
- `title: str`
- `doc_type: Optional[str]`     # "page", "file", etc.
- `mime_type: Optional[str]`    # for files
- `created_by_cdm_id: Optional[str]`
- `updated_by_cdm_id: Optional[str]`
- `created_at: Optional[datetime]`
- `updated_at: Optional[datetime]`
- `url: Optional[str]`
- `tags: List[str]`
- `properties: Dict[str, Any]`  # labels, full path, custom fields, etc.

#### 1.3. `CdmDocRevision`

Represent a version of a document.

- `cdm_id: str`  
  - e.g. `cdm:doc:revision:confluence:<pageId>:<version>`
- `source_system: str`
- `source_revision_id: str`
- `item_cdm_id: str`
- `revision_number: Optional[int]`
- `revision_label: Optional[str]`
- `author_cdm_id: Optional[str]`
- `created_at: Optional[datetime]`
- `summary: Optional[str]`
- `properties: Dict[str, Any]`

#### 1.4. `CdmDocLink`

Represent a logical link (internal/external/attachment).

- `cdm_id: str`
- `source_system: str`
- `source_link_id: str`
- `from_item_cdm_id: str`
- `to_item_cdm_id: Optional[str]`  # None for external link
- `url: Optional[str]`
- `link_type: Optional[str]`       # "internal", "external", "attachment"
- `created_at: Optional[datetime]`
- `properties: Dict[str, Any]`

Export all four types via `__all__`.

### 2. Confluence → CDM docs mapping

Create:

- `platform/spark-ingestion/packages/metadata-service/src/metadata_service/cdm/confluence_docs_mapper.py`

Functions (pure, no I/O):

```python
def map_confluence_space_to_cdm(space: dict, *, source_system: str = "confluence") -> CdmDocSpace: ...

def map_confluence_page_to_cdm(
    page: dict,
    *,
    space_cdm_id: str,
    parent_item_cdm_id: Optional[str],
    source_system: str = "confluence",
) -> CdmDocItem: ...

def map_confluence_page_version_to_cdm(
    page: dict,
    version: dict,
    *,
    item_cdm_id: str,
    source_system: str = "confluence",
) -> CdmDocRevision: ...

def map_confluence_link_to_cdm(
    link: dict,
    *,
    from_item_cdm_id: str,
    maybe_target_item_cdm_id: Optional[str],
    source_system: str = "confluence",
) -> CdmDocLink: ...
````

Inputs:

* `space`, `page`, `version`, `link` are **normalized** Confluence payloads (from the endpoint’s internal model), not raw HTTP responses.

Requirements:

* `cdm_id` derived deterministically from `source_system` + native IDs.
* Basic fields (title, created/updated timestamps, URLs) mapped to top-level CDM fields.
* Confluence-specific extras (labels, macros, etc.) in `properties`.

### 3. OneDrive → CDM docs mapping

Create:

* `platform/spark-ingestion/packages/metadata-service/src/metadata_service/cdm/onedrive_docs_mapper.py`

Functions:

```python
def map_onedrive_drive_to_cdm(
    drive: dict,
    *,
    source_system: str = "onedrive",
) -> CdmDocSpace: ...

def map_onedrive_item_to_cdm(
    item: dict,
    *,
    space_cdm_id: str,
    parent_item_cdm_id: Optional[str],
    source_system: str = "onedrive",
) -> CdmDocItem: ...

def map_onedrive_item_version_to_cdm(
    item: dict,
    version: dict,
    *,
    item_cdm_id: str,
    source_system: str = "onedrive",
) -> CdmDocRevision: ...

def map_onedrive_link_to_cdm(
    link: dict,
    *,
    from_item_cdm_id: str,
    maybe_target_item_cdm_id: Optional[str],
    source_system: str = "onedrive",
) -> CdmDocLink: ...
```

Same rules: pure, deterministic IDs, source-specific extras in `properties`.

### 4. How docs CDM ties into planner & sinks (docs only)

Update or add:

* `docs/meta/nucleus-architecture/CDM-DOCS-MODEL.md`

  * Describe `CdmDocSpace`, `CdmDocItem`, `CdmDocRevision`, `CdmDocLink`.
  * Show mapping to Confluence (space/page/version/link) and OneDrive (drive/item/version/link).
  * Explain ID patterns and relationships.

* `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md`

  * Note that Confluence/OneDrive ingestion units will advertise `cdm_model_id` values:

    * `"cdm.doc.space"`, `"cdm.doc.item"`, `"cdm.doc.revision"`, `"cdm.doc.link"`.
  * Explain that planner + strategies will:

    * use docs metadata (spaces/drives) and incremental fields (modified times),
    * generate ingestion segments per space/folder, similar to Jira’s per-project slices.
  * Reiterate that CDM mapping happens in Python during ingestion (Source→Staging→CDM→Sink).

No code changes to ingestion workflows or sinks in this slug—just the model + mapping + docs.

## Data & State

* New Python types for docs CDM; no database schema change.
* No ingestion state changes; future slugs will wire these into ingestion.

## Constraints

* CDM docs must remain stable and additive; avoid breaking fields.
* Do not directly encode Confluence/OneDrive API quirks into top-level CDM fields.

## Acceptance Mapping

* AC1 → CDM docs classes exist + tested.
* AC2 → Confluence→CDM mapping exists + tested.
* AC3 → OneDrive→CDM mapping exists + tested.
* AC4 → Architecture docs exist and describe docs CDM + bindings.

## Risks / Open Questions

* R1: Some sources may lack explicit “spaces” or revisions; CDM must tolerate partial data.
* Q1: How aggressive we want to be with revisions (every small edit vs coarse snapshots); chosen later via ingestion unit policy, not CDM.
