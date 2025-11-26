# SPEC — Metadata worker capabilities and HTTP preview v1

## Problem

`metadata_worker.py` currently:

- branches explicitly on Jira HTTP vs JDBC (template-id checks),
- imports Jira-specific dataset definitions and constructs Jira endpoints directly, and
- implements preview only for JDBC (SQLAlchemy).

This conflicts with the intended architecture where:

- endpoints and their metadata subsystems own source-specific behavior,
- the worker is a thin orchestrator that relies on capabilities, and
- preview should be a capability (`metadata.preview`) usable by JDBC, HTTP, CDM, and future semantic endpoints.

We need to make the worker capability-driven and move Jira specifics out, without breaking existing catalog behavior.

## Interfaces / Contracts

### 1. Capability-driven metadata planning

Introduce a planner abstraction:

```python
# metadata_service/planning.py (conceptual)

class MetadataCollectionPlanner(Protocol):
    def plan_jobs(
        self,
        request: CollectionJobRequest,
        logger: ActivityLogger,
    ) -> list[MetadataJob]:
        ...

def plan_metadata_jobs(
    request: CollectionJobRequest,
    logger: ActivityLogger,
) -> list[MetadataJob]:
    ...
````

Key responsibilities of `plan_metadata_jobs`:

* Read `request.config` to get `templateId` and endpoint parameters.
* Look up the endpoint descriptor from the Python registry.
* Based on family + capabilities:

  * For JDBC endpoints:

    * Use existing logic (information_schema expansion + EndpointFactory.build_source + MetadataCapableEndpoint).
  * For Jira HTTP (and future HTTP/semantic endpoints):

    * Delegate to the Jira metadata subsystem (e.g., `jira_metadata.plan_jobs(request, logger)`), which uses its own dataset definitions and knows how to build MetadataJobs.

**Worker change**:

In `metadata_worker._collect_catalog_snapshots_sync`:

* Replace explicit Jira vs JDBC branching with:

```python
logger = ActivityLogger()
jobs = plan_metadata_jobs(request, logger)
if not jobs:
    logger.warn("no metadata jobs planned")
    return {"records": [], "logs": logger.entries}
metadata_service.run(jobs)
# then read from CacheMetadataRepository and build CatalogRecordOutput as today
```

**Constraints**:

* `CollectionJobRequest`, `MetadataJob`, and `CatalogRecordOutput` remain unchanged.
* Jira-specific constants like `JIRA_DATASET_DEFINITIONS` must be referenced from Jira subsystem code, not from metadata_worker.
* The shared planner lives under `metadata_service.planning` so other runtimes/tests can import it. The worker simply imports and executes `plan_metadata_jobs(request, logger)`.

### 2. HTTP-aware preview via endpoint capability

Current behavior:

* `_preview_dataset_sync(request)` assumes JDBC: builds SQLAlchemy tool from `connectionUrl` and runs `SELECT * ... LIMIT N`.

New behavior:

1. Resolve the dataset’s endpoint and template in GraphQL (before calling Temporal):

   * Using the catalog record + `MetadataEndpoint` row, detect whether the source is JDBC or HTTP.
   * For HTTP/semantic endpoints encode the template id + parameters + dataset metadata into a JSON payload and pass it via the existing `connectionUrl` field (preserves the activity signature). For JDBC continue sending the raw JDBC URL.

2. In the worker, detect JSON payloads and route them through the endpoint’s metadata subsystem when `metadata.preview` is advertised. Otherwise fall back to the JDBC SQLAlchemy preview.

3. Jira’s metadata subsystem now exposes `preview_dataset`, which reuses the `_sync_jira_*` helpers with small `max_records` limits and returns row dictionaries (projects/issues/users/comments/worklogs).

4. Endpoints that do not expose `metadata.preview` still raise a clear `E_CAPABILITY_MISSING` error before the workflow is scheduled.

### 3. Ingestion behavior (clarification only)

`_run_ingestion_unit_sync` already calls the Python ingestion runtime based on unitId (with a Jira special case). For this slug we:

* Do **not** change signatures or functional behavior,
* Only clarify in code comments/docs that:

  * bulk ingestion rows are moved inside Python (SourceEndpoint → StagingProvider → SinkEndpoint),
  * `records` in `IngestionUnitResult` are optional, small semantic payloads (for KB updates), not the main data stream.

This reinforces the invariant that Temporal/TS do not move bulk data.

## Data & State

* DB schemas remain unchanged.
* All metadata collection still ends up in the same catalog record shapes.
* No changes to KV or IngestionUnitState for this slug.

## Constraints

* GraphQL APIs and Temporal activities remain compatible (no signature changes).
* Tests that assert current catalog contents for JDBC and Jira must continue to pass.
* Preview results for JDBC datasets must remain unchanged in shape.
* Add targeted unit tests (planner + preview payload decoding) so future connectors can rely on the shared helpers.

## Acceptance Mapping

* AC1 → Metadata planner abstraction exists; metadata_worker uses it; Jira-specific logic removed from metadata_worker.
* AC2 → Integration tests (and/or snapshot comparison) show identical Jira catalog datasets pre‑ and post‑refactor.
* AC3 → New preview tests for Jira (HTTP) succeed, JDBC preview still works, unsupported datasets fail with a clear error.
* AC4 → Docs and code comments explicitly document the “bulk in Python, small summaries in TS” ingestion rule.

## Risks / Open Questions

* R1: Need to choose a non-circular place for `plan_metadata_jobs` (probably metadata_service/planning or similar).
* R2: Mapping from datasetId → endpoint/template may require a small helper in metadata-api; must ensure we use the same logic as catalog UI.
* Q1: For non-Jira HTTP endpoints in future, should we expose a common preview interface, or let each endpoint family decide its own preview semantics as long as it fits the `metadata.preview` capability?
