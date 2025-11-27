# CDM Work Model

Nucleus standardizes "work" data (projects, issues, people, collaboration) through a lightweight Common Data Model (CDM). The CDM defines canonical schemas for semantic sinks and analytics so ingestion units can describe *what* they emit, regardless of the upstream tool.

## Core entities

### `CdmWorkProject` (`cdm.work.project`)
- **ID format:** `cdm:work:project:<source_system>:<native_key>` (e.g., `cdm:work:project:jira:ENG`).
- **Fields:** `source_system`, `source_project_key`, `name`, optional `description`, `url`, plus a `properties` bag for domain-specific metadata (project type, lead, category, etc.).

### `CdmWorkUser` (`cdm.work.user`)
- **ID format:** `cdm:work:user:<source_system>:<account_id>`.
- **Fields:** `source_user_id`, `display_name`, optional `email`, `active`, and extensible `properties` (timezone, org, roles).

### `CdmWorkItem` (`cdm.work.item`)
- Represents a task/issue/epic.
- **ID format:** `cdm:work:item:<source_system>:<issue_key>`.
- **Fields:** project FK (`project_cdm_id`), reporter/assignee FKs, `issue_type`, `status`, `status_category`, `priority`, textual fields (`summary`, `description`), labels array, timestamps (`created_at`, `updated_at`, `closed_at`), and a `properties` bag for custom fields/raw payloads.

### `CdmWorkComment` (`cdm.work.comment`)
- Discussion entries attached to work items.
- **ID format:** `cdm:work:comment:<source_system>:<issue_key>:<comment_id>`.
- Tracks `item_cdm_id`, `author_cdm_id`, `body`, timestamps, optional `visibility`, and a `properties` bag (rendered HTML, restrictions, etc.).

### `CdmWorkLog` (`cdm.work.worklog`)
- Time tracking rows linked to work items.
- **ID format:** `cdm:work:worklog:<source_system>:<issue_key>:<worklog_id>`.
- Fields include `author_cdm_id`, `started_at`, `time_spent_seconds`, optional `comment`, `visibility`, and `properties` for source-specific flags.

> Future slugs can extend this catalog with iterations/boards/relations by adding new dataclasses and keeping existing ones backward compatible.

## Binding Jira to the CDM

The Jira metadata subsystem normalizes REST payloads (projects, issues, users, comments, worklogs). `metadata_service/cdm/jira_work_mapper.py` contains pure helpers that convert those normalized records into the CDM dataclasses above.

Each Jira ingestion unit now declares its CDM target via `cdm_model_id`:

| Dataset / Unit | `cdm_model_id` |
| --------------- | -------------- |
| `jira.projects` | `cdm.work.project` |
| `jira.issues`   | `cdm.work.item` |
| `jira.users`    | `cdm.work.user` |
| `jira.comments` | `cdm.work.comment` |
| `jira.worklogs` | `cdm.work.worklog` |

The shared catalog (`runtime_common/endpoints/jira_catalog.py`) and endpoint extras (`jira_http.py`) expose these bindings so the API/UI/automation can reason about downstream sinks.

## KB vs. CDM sinks

The Knowledge Base stores semantic nodes/edges (relationships, lineage, reasoning context). CDM models capture **row-level** work data for analytics and data products. Ingestion units may publish KB nodes for discovery, but the authoritative record for projects/items/users/comments/worklogs is the CDM sink (lakehouse, warehouse, etc.).

When a new connector ships, it should:
1. Define or reuse CDM models for the entities it emits.
2. Provide mapping helpers similar to `jira_work_mapper.py`.
3. Tag each ingestion unit with the appropriate `cdm_model_id`.
4. Document the mapping so downstream tools know how to materialize CDM tables.
