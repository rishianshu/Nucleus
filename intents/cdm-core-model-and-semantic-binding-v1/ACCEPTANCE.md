## 3) `intents/cdm-core-model-and-semantic-binding-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) CDM work models implemented and tested
   - Type: unit
   - Evidence:
     - A Python module (e.g., `runtime_core/cdm/work.py`) defines `CdmWorkProject`, `CdmWorkUser`, `CdmWorkItem`, `CdmWorkComment`, and `CdmWorkLog`.
     - Unit tests construct each model with typical data, assert required fields, and verify default behavior for optional fields and `properties`.

2) Jira→CDM mapping helpers implemented and tested
   - Type: unit
   - Evidence:
     - A module such as `metadata_service/cdm/jira_work_mapper.py` (or equivalent) exposes pure functions:
       - `map_jira_project_to_cdm`
       - `map_jira_user_to_cdm`
       - `map_jira_issue_to_cdm`
       - `map_jira_comment_to_cdm`
       - `map_jira_worklog_to_cdm`
     - Unit tests:
       - Use representative normalized Jira payloads for projects, users, issues, comments, and worklogs.
       - Assert deterministic `cdm_id` values based on `source_system` + Jira keys/ids.
       - Check key field mappings (e.g., summary/status/priority for items; body/author/timestamps for comments; time spent for worklogs).
       - Verify that Jira-specific extras land under `properties`.

3) Jira ingestion units expose CDM binding metadata
   - Type: unit
   - Evidence:
     - Tests that instantiate the Jira endpoint and inspect its ingestion units (e.g., `list_units()`):
       - Units for projects/issues/users carry `cdm_model_id` values:
         - `"cdm.work.project"`, `"cdm.work.item"`, `"cdm.work.user"` respectively.
       - If units exist for comments and worklogs, they carry `"cdm.work.comment"` and `"cdm.work.worklog"`.
       - Units without CDM bindings either omit `cdm_model_id` or leave it as `None`.

4) CDM work model + binding documented and referenced
   - Type: integration (docs)
   - Evidence:
     - `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md` exists and describes:
       - `CdmWorkProject`, `CdmWorkUser`, `CdmWorkItem`, `CdmWorkComment`, `CdmWorkLog`.
       - The structure of `cdm_id` and relationships between entities.
     - `docs/meta/nucleus-architecture/ENDPOINTS.md` and `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md` mention:
       - The CDM work model by name.
       - That Jira ingestion units expose `cdm_model_id` to identify their CDM targets.
````

---

