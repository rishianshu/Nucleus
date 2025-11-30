# CDM Mapper Refactor (Future Requirement)

## Goal
Keep `platform/spark-ingestion/temporal/metadata_worker.py` vendor-agnostic by loading CDM mapping logic dynamically per endpoint/unit instead of branching on `jira.*` / `confluence.*`.

## Requirements
1. **Shared registry/package**
   - Introduce a Python module (e.g., `metadata_service.cdm.registry`) that lets runtimes register mapper functions keyed by endpoint + unit ID (or dataset ID).
   - API shape:
     ```python
     register_cdm_mapper(endpoint="jira.http", unit_id="jira.issues", mapper=...)
     apply_cdm(endpoint="jira.http", unit_id="jira.issues", records=[...], default_model=None) -> List[Dict]
     ```
   - Support multiple models per unit (e.g., Confluence pages emit `cdm.doc.item` + `cdm.doc.revision` in one call).

2. **Endpoint modules register themselves**
   - Jira runtime registers its work-item/comment/worklog mappers.
   - Confluence runtime registers doc-space/page/attachment mappers.
   - Future endpoints only touch their own modules; no metadata_worker edits.

3. **Worker integration**
   - Replace `_apply_jira_cdm_mapping` / `_apply_confluence_cdm_mapping` with registry lookups.
   - Worker stays generic: call `apply_cdm(...)` when `dataMode == "cdm"`, regardless of endpoint.

4. **Testing**
   - Registry unit tests covering single-model and multi-model outputs, plus idempotent registration.
   - Update existing Jira/Confluence ingestion tests to use the registry to ensure backward compatibility.

5. **Docs**
   - Document how endpoint runtimes register CDM mappers (location TBD, likely `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md`).

## Notes
- Keep backward compatibility while migrating (e.g., register existing mappers before removing worker branches).
- Consider lazy imports to avoid circular dependencies between runtimes and the registry.
