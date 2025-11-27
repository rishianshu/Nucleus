# Plan

1. **Understand scope & existing CDM patterns** – review INTENT/SPEC/AC plus current work CDM implementation (`runtime_core/cdm/work.py`) to mirror structure, ID strategy, and tests.
2. **Implement `cdm.docs` module** – add dataclasses for `CdmDocSpace`, `CdmDocItem`, `CdmDocRevision`, `CdmDocLink`, ID helpers, and pytest coverage.
3. **Add mapping helpers** – create Confluence and OneDrive mapping utilities that accept normalized payloads and emit the CDM docs models with deterministic IDs (plus unit tests covering typical payloads).
4. **Documentation & binding guidance** – update architecture docs to introduce the docs CDM, explain how future ingestion/planner hooks will consume it, and describe Confluence/OneDrive mapping expectations; ensure LOG/TODO/story synced.
