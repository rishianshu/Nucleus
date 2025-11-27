# CDM Docs Model

The documents CDM defines a stable, connector-agnostic representation for collaborative knowledge: spaces/drives, individual documents, their revisions, and logical links. It mirrors the CDM work module so ingestion units can describe “what” they emit (via `cdm_model_id`) without exposing source-specific payloads.

## Core entities

### `CdmDocSpace` (`cdm.doc.space`)
- **ID format:** `cdm:doc:space:<source_system>:<native_id>` (examples: `cdm:doc:space:confluence:SPACEKEY`, `cdm:doc:space:onedrive:driveId`).
- **Fields:** `source_space_id`, optional `key`, `name`, `description`, `url`, and an extensible `properties` bag (space status, type, owner, etc.).

### `CdmDocItem` (`cdm.doc.item`)
- Represents a page/file/folder.
- **ID format:** `cdm:doc:item:<source_system>:<native>` (OneDrive items append drive id: `cdm:doc:item:onedrive:<driveId>:<itemId>`).
- **Fields:** `space_cdm_id`, optional `parent_item_cdm_id`, `doc_type`, `mime_type`, author pointers (`created_by_cdm_id`, `updated_by_cdm_id`), timestamps, `url`, tag list, and `properties` (paths, custom fields, permissions, etc.).

### `CdmDocRevision` (`cdm.doc.revision`)
- Immutable version metadata.
- **ID format:** `cdm:doc:revision:<source_system>:<item_native_id>:<revision_native_id>`.
- **Fields:** `revision_number`, `revision_label`, `author_cdm_id`, timestamp, optional summary, and `properties` (size, flags, etc.).

### `CdmDocLink` (`cdm.doc.link`)
- Logical edge from one doc to another (or an external URL).
- **ID format:** `cdm:doc:link:<source_system>:<link_id_or_url_hash>`.
- **Fields:** `from_item_cdm_id`, optional `to_item_cdm_id`, `url`, `link_type` (“internal”, “external”, “attachment”), timestamp, and arbitrary `properties`.

All dataclasses live in `runtime_core/cdm/docs.py` alongside the work CDM.

## Confluence binding

`metadata_service/cdm/confluence_docs_mapper.py` exposes pure helpers that convert normalized Confluence payloads into CDM rows:

| Normalized payload | Function | `cdm_model_id` |
| --- | --- | --- |
| Space | `map_confluence_space_to_cdm` | `cdm.doc.space` |
| Page | `map_confluence_page_to_cdm` | `cdm.doc.item` |
| Page version | `map_confluence_page_version_to_cdm` | `cdm.doc.revision` |
| Link/reference | `map_confluence_link_to_cdm` | `cdm.doc.link` |

ID conventions leverage Atlassian IDs/keys, and timestamps come from the already-normalized metadata (`history.createdDate`, `version.when`, etc.). Confluence extras—labels, macros, restrictions—flow through the `properties` bag so downstream consumers can enrich analytics or search indices without touching raw REST payloads.

## OneDrive binding

`metadata_service/cdm/onedrive_docs_mapper.py` performs the same role for Microsoft Graph/OneDrive payloads:

| Normalized payload | Function | `cdm_model_id` |
| --- | --- | --- |
| Drive/site | `map_onedrive_drive_to_cdm` | `cdm.doc.space` |
| Drive item (file/folder) | `map_onedrive_item_to_cdm` | `cdm.doc.item` |
| Item version | `map_onedrive_item_version_to_cdm` | `cdm.doc.revision` |
| Sharing link | `map_onedrive_link_to_cdm` | `cdm.doc.link` |

Deterministic IDs (`cdm:doc:item:onedrive:<driveId>:<itemId>`) make it easy to correlate revisions and links, while the `properties` bag carries size, drive metadata, and permissions. User references (creators/modifiers) reuse CDM user identifiers (`cdm:work:user:*` for Atlassian, `cdm:identity:user:*` for Graph identities).

## Planner & sink implications

- Ingestion units for Confluence/OneDrive will declare the relevant `cdm_model_id` for every dataset so planner/console logic can reason about compatibility with CDM-enabled sinks.
- Planner strategies can slice work per space/drive (similar to Jira per project) leveraging the normalized metadata and the same deterministic IDs.
- Sinks (warehouse, lakehouse, or CDM Postgres template) can reuse the provisioning approach introduced for work CDM: each model maps to a well-defined table schema keyed by `cdm_id`.

No ingestion wiring changes land in this slug; the focus is defining the CDM surface area and pure mapping helpers so downstream slugs can adopt them.
