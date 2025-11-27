# Story — cdm-docs-model-and-semantic-binding-v1

- 2025-11-27: Introduced the docs CDM dataclasses, added Confluence/OneDrive mapping helpers with deterministic IDs, wrote pytest coverage for all models/mappers, and updated the architecture docs (`CDM-DOCS-MODEL.md`, `INGESTION_AND_SINKS.md`) to describe how `cdm.doc.*` units bind into planner and sinks (tests: `python3 -m pytest platform/spark-ingestion/packages/core/tests/test_cdm_docs.py platform/spark-ingestion/tests/test_cdm_confluence_mapper.py platform/spark-ingestion/tests/test_cdm_onedrive_mapper.py`).
