# Plan — cdm-core-model-and-semantic-binding-v1

1. **CDM model definitions**  
   - Add `runtime_core/cdm/work.py` (and `__init__.py` if needed) with dataclasses for project/user/item/comment/worklog, plus constants for CDM IDs.  
   - Add corresponding unit tests with representative payloads.

2. **Jira→CDM mapping**  
   - Create `metadata_service/cdm/jira_work_mapper.py` with pure functions mapping normalized Jira records to CDM models.  
   - Add tests covering projects, users, issues, comments, worklogs (using fixtures from existing normalized datasets).

3. **Ingestion unit metadata**  
   - Extend Jira ingestion unit descriptors to include `cdm_model_id`.  
   - Update unit tests (e.g., `runtime_common/endpoints/jira_http.py` tests) verifying the metadata is present.

4. **Docs**  
   - Author `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md`.  
   - Update `ENDPOINTS.md` and `INGESTION_AND_SINKS.md` to mention the CDM models + `cdm_model_id` contract.

5. **Verify + clean up**  
   - Run relevant unit tests (new Python tests).  
   - Run lint/doc check if applicable.
