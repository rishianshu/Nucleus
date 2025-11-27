# Acceptance Criteria

1) CDM docs models implemented and tested
   - Type: unit
   - Evidence:
     - A Python module (e.g., `runtime_core/cdm/docs.py`) defines:
       - `CdmDocSpace`, `CdmDocItem`, `CdmDocRevision`, `CdmDocLink`.
     - Unit tests instantiate each model with realistic data and assert:
       - required fields are enforced,
       - optional fields behave as expected,
       - `properties` can carry arbitrary source-specific details.

2) Confluence→CDM mapping helpers implemented and tested
   - Type: unit
   - Evidence:
     - A module (e.g., `metadata_service/cdm/confluence_docs_mapper.py`) implements:
       - space/page → `CdmDocSpace`/`CdmDocItem`,
       - version → `CdmDocRevision`,
       - links → `CdmDocLink`.
     - Tests:
       - feed normalized Confluence payloads,
       - assert deterministic `cdm_id`s,
       - assert correct mapping of titles, relationships (space/item/parent), timestamps, and URLs,
       - assert Confluence-specific extras go into `properties`.

3) OneDrive→CDM mapping helpers implemented and tested
   - Type: unit
   - Evidence:
     - A module (e.g., `metadata_service/cdm/onedrive_docs_mapper.py`) implements:
       - drive/item → `CdmDocSpace`/`CdmDocItem`,
       - version → `CdmDocRevision`,
       - links → `CdmDocLink`.
     - Tests mirror Confluence tests:
       - deterministic IDs,
       - correct relationships and timestamps,
       - source-specific details in `properties`.

4) Docs CDM architecture documented
   - Type: docs / integration
   - Evidence:
     - `docs/meta/nucleus-architecture/CDM-DOCS-MODEL.md` explains:
       - the docs CDM entities and relationships,
       - how Confluence/OneDrive map into them,
       - how they will feed ingestion/sinks.
     - `INGESTION_AND_SINKS.md` mentions:
       - use of `cdm.doc.*` model IDs,
       - expectation that future Confluence/OneDrive ingestion units advertise those IDs.
