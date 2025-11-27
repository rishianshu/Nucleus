## 2) `intents/cdm-core-model-and-semantic-binding-v1/SPEC.md`

````markdown
# SPEC — CDM core work model & Jira binding v1

## Problem

Nucleus is meant to be a semantic brain for work: it should understand projects, tasks, people, and the actual activity around them (comments, time spent, changes). Today:

- Jira metadata and ingestion are primarily Jira-shaped.
- The emerging CDM idea only covers projects, users, and items, ignoring key artifacts like comments and worklogs.
- There is no single, versioned place where the “work CDM” is defined, nor a clean Jira→CDM mapping layer.
- Ingestion units do not declare explicitly which CDM entity they represent.

We need:

1. A **central CDM work model** that is rich enough for Jira-like tools (project, user, item, comment, worklog).
2. A **pure Jira→CDM mapping layer**.
3. A way for Jira ingestion units to **declare which CDM model they feed**.

This slug does not change sinks or pipelines; it defines types + mappings + metadata so later slugs can wire them into CDM sinks.

## Interfaces / Contracts

### 1. CDM Work Model (Python)

Create a CDM work model module, e.g.:

- `platform/spark-ingestion/runtime_core/cdm/work.py`

This module defines dataclasses (or equivalent typed classes). The core models for this slug:

#### `CdmWorkProject`

Represents a project/workspace/repo in a work tool.

Fields (minimum):

- `cdm_id: str`  
  - e.g., `cdm:work:project:jira:PROJKEY`
- `source_system: str`  
  - e.g., `"jira"`
- `source_project_key: str`
- `name: str`
- `description: Optional[str]`
- `url: Optional[str]`
- `properties: Dict[str, Any]`  
  - bag for source-specific extras (components, categories, etc.)

#### `CdmWorkUser`

Represents a person/account.

- `cdm_id: str`  
  - `cdm:work:user:jira:<accountId>`
- `source_system: str`
- `source_user_id: str`
- `display_name: str`
- `email: Optional[str]`
- `active: Optional[bool]`
- `properties: Dict[str, Any]`  
  - org, roles, teams, etc.

#### `CdmWorkItem`

Canonical unit of work (issue/task/story/bug):

- `cdm_id: str`  
  - `cdm:work:item:jira:<issueKey>`
- `source_system: str`
- `source_issue_key: str`
- `project_cdm_id: str`
- `reporter_cdm_id: Optional[str]`
- `assignee_cdm_id: Optional[str]`
- `issue_type: Optional[str]`          # story, bug, task, etc.
- `status: Optional[str]`
- `status_category: Optional[str]`     # e.g., To Do/In Progress/Done
- `priority: Optional[str]`
- `summary: str`
- `description: Optional[str]`
- `labels: List[str]`
- `created_at: Optional[datetime]`
- `updated_at: Optional[datetime]`
- `closed_at: Optional[datetime]`
- `properties: Dict[str, Any]`         # custom fields, raw payload, etc.

#### `CdmWorkComment`

Represents a comment/discussion message on a work item.

- `cdm_id: str`  
  - `cdm:work:comment:jira:<issueKey>:<commentId>`
- `source_system: str`
- `source_comment_id: str`
- `item_cdm_id: str`                  # FK to CdmWorkItem.cdm_id
- `author_cdm_id: Optional[str]`      # FK to CdmWorkUser.cdm_id
- `body: str`
- `created_at: Optional[datetime]`
- `updated_at: Optional[datetime]`
- `visibility: Optional[str]`         # internal/public/role, etc.
- `properties: Dict[str, Any]`        # rendered HTML, restrictions, etc.

#### `CdmWorkLog`

Represents a time tracking entry on a work item.

- `cdm_id: str`  
  - `cdm:work:worklog:jira:<issueKey>:<worklogId>`
- `source_system: str`
- `source_worklog_id: str`
- `item_cdm_id: str`                  # FK to CdmWorkItem.cdm_id
- `author_cdm_id: Optional[str]`      # FK to CdmWorkUser.cdm_id
- `started_at: Optional[datetime]`
- `time_spent_seconds: Optional[int]`
- `comment: Optional[str]`
- `visibility: Optional[str]`
- `properties: Dict[str, Any]`        # original units, billing flags, etc.

Optional (for documentation only in this slug):

- `CdmWorkRelation` (item→item links),
- `CdmWorkIteration` (sprints/iterations),
- `CdmWorkBoard` (boards/backlogs).

These may be sketched as stubs, but they are not required to have full mappings/tests in this slug.

Export list:

```python
__all__ = [
    "CdmWorkProject",
    "CdmWorkUser",
    "CdmWorkItem",
    "CdmWorkComment",
    "CdmWorkLog",
]
````

### 2. Jira → CDM mapping layer (Python)

Add a Jira-to-CDM mapping module, e.g.:

* `platform/spark-ingestion/packages/metadata-service/src/metadata_service/cdm/jira_work_mapper.py`

This module exposes pure functions:

```python
def map_jira_project_to_cdm(project: dict, *, source_system: str = "jira") -> CdmWorkProject: ...
def map_jira_user_to_cdm(user: dict, *, source_system: str = "jira") -> CdmWorkUser: ...
def map_jira_issue_to_cdm(
    issue: dict,
    *,
    project_cdm_id: str,
    reporter_cdm_id: Optional[str],
    assignee_cdm_id: Optional[str],
    source_system: str = "jira",
) -> CdmWorkItem: ...

def map_jira_comment_to_cdm(
    comment: dict,
    *,
    item_cdm_id: str,
    source_system: str = "jira",
) -> CdmWorkComment: ...

def map_jira_worklog_to_cdm(
    worklog: dict,
    *,
    item_cdm_id: str,
    author_cdm_id: Optional[str],
    source_system: str = "jira",
) -> CdmWorkLog: ...
```

Requirements:

* Inputs are **normalized Jira shapes** from existing Jira metadata/ingestion code (not raw HTTP responses), e.g., datasets representing `jira.projects`, `jira.issues`, `jira.users`, `jira.comments`, `jira.worklogs`.
* `cdm_id` is deterministic given `source_system` and the relevant native key(s).
* All Jira-specific fields not included in the top-level CDM fields must go into `properties`.

These functions:

* Do no I/O (no DB, no HTTP).
* Do not write to sinks, KB, or GraphQL.
* Are reusable by future ingestion units and sinks.

### 3. CDM binding metadata on Jira ingestion units

Extend the endpoint-ingestion metadata so units can declare which CDM model they feed.

Assuming an ingestion unit descriptor like:

```python
@dataclass
class IngestionUnitDescriptor:
    id: str
    name: str
    dataset: str
    # NEW:
    cdm_model_id: Optional[str] = None  # e.g. "cdm.work.item"
```

Update Jira endpoint ingestion unit definitions (e.g., `runtime_common/endpoints/jira_http.py` or similar) so that:

* The unit that reads from Jira projects uses:

  * `cdm_model_id = "cdm.work.project"`
* The unit that reads from issues uses:

  * `cdm_model_id = "cdm.work.item"`
* The unit that reads from users uses:

  * `cdm_model_id = "cdm.work.user"`
* If ingestion units exist for comments and worklogs:

  * `cdm_model_id = "cdm.work.comment"`
  * `cdm_model_id = "cdm.work.worklog"`

Define constants in a shared module, e.g.:

```python
CDM_WORK_PROJECT = "cdm.work.project"
CDM_WORK_ITEM = "cdm.work.item"
CDM_WORK_USER = "cdm.work.user"
CDM_WORK_COMMENT = "cdm.work.comment"
CDM_WORK_WORKLOG = "cdm.work.worklog"
```

Rules:

* Units must only set `cdm_model_id` when there is a known mapping function to a CDM model.
* Units should still obey the metadata-first contract: datasets must exist in catalog before ingestion is configured.

### 4. CDM docs

Add a dedicated doc:

* `docs/meta/nucleus-architecture/CDM-WORK-MODEL.md`

Contents:

* Brief overview of the work CDM and its purpose.
* Descriptions of `CdmWorkProject`, `CdmWorkUser`, `CdmWorkItem`, `CdmWorkComment`, `CdmWorkLog`:

  * fields, IDs, relationships.
* Explanation that:

  * CDM models define row-level domain entities for sinks/analytics/apps.
  * KB remains for semantic/graph metadata and signals, not bulk row storage.
* Clarify how Jira datasets and ingestion units map to CDM:

  * e.g., `jira.issues` → `CdmWorkItem`, `jira.comments` → `CdmWorkComment`.

Update:

* `docs/meta/nucleus-architecture/ENDPOINTS.md` to list Jira as a **CDM-aware** semantic endpoint.
* `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md` to mention `cdm_model_id` on ingestion units and how CDM models are consumed by sinks.

## Data & State

* No DB schema changes.
* CDM classes live only in code for now (Python + docs); they prepare the ground for later slugs to create actual CDM sinks/tables.
* Jira catalog datasets stay as they are; this slug only adds mapping functions and unit metadata.

## Constraints

* Mapping must not perform any I/O or side-effects.
* CDM model changes in future must be additive (new optional fields only).
* No ingestion/Temporal workflow signature changes in this slug.
* KB schema remains unchanged; this slug does not push CDM entities into KB.

## Acceptance Mapping

* AC1 → CDM work models for project/user/item/comment/worklog exist in Python and pass unit tests.
* AC2 → Jira→CDM mapping helpers for those five entities are implemented and unit-tested on sample payloads.
* AC3 → Jira ingestion unit descriptors expose `cdm_model_id` for the relevant datasets.
* AC4 → CDM work model and CDM binding are documented in architecture docs and referenced from endpoint/ingestion docs.

## Risks / Open Questions

* R1: Jira tenants with very large comment/worklog volumes may require careful ingestion policies; this slug only defines models and mappings, not policies.
* R2: Other work tools may have subtly different semantics (e.g., multiple assignees); we rely on `properties` to capture tool-specific richness without breaking the CDM.
* Q1: How aggressively should we ingest comments/worklogs by default? That belongs in an ingestion-policy slug; here we only ensure the CDM can represent them cleanly.

