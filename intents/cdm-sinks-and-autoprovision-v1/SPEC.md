# SPEC — CDM sinks & autoprovision v1

## Problem

We now have:

- CDM work models (`CdmWorkItem`, `CdmWorkComment`, etc.).
- Jira→CDM mappers.
- Ingestion units that can run in `mode = "raw" | "cdm"` and advertise `cdm_model_id`.

But:

- There is no **CDM sink endpoint** that knows how to store `cdm.work.*` entities.
- There is no **autoprovision flow** that creates CDM tables and registers them as datasets.
- CDM-mode ingestion currently has nowhere concrete to land data.

We need:

1. A CDM-aware sink endpoint (internal) that writes CDM rows to a physical store.
2. A mechanism to autoprovision CDM tables for specific CDM models.
3. A way to publish CDM datasets into the metadata catalog, so they show up in the same universe as other datasets.

## Interfaces / Contracts

### 1. CDM sink endpoint template

Introduce a new sink endpoint family, for example:

- Template id: `cdm.jdbc` (or similar)
- Family: `CDM_SINK` (or `JDBC` with CDM capabilities)
- Backed by: Postgres via SQLAlchemy/Prisma, reusing existing infra.

Endpoint config (conceptual):

```jsonc
{
  "templateId": "cdm.jdbc",
  "parameters": {
    "connection_url": "postgresql://...",
    "schema": "cdm_work",          // default schema
    "table_prefix": "cdm_",        // optional
    "models": ["cdm.work.item", "cdm.work.comment", ...] // optional hint
  }
}
````

Capabilities:

```python
cdm_capabilities = {
    "supports_raw": False,
    "supports_cdm_work": True,
    "supported_cdm_models": [
        "cdm.work.project",
        "cdm.work.user",
        "cdm.work.item",
        "cdm.work.comment",
        "cdm.work.worklog",
    ],
    "sink.autoprovision": True,
}
```

The sink endpoint must provide:

* A write API for ingestion worker:

  * Given an iterator of CDM-shaped dicts or dataclasses + a `cdm_model_id`, write them to the appropriate table.
* An autoprovision API:

  * Given a `cdm_model_id`, ensure DDL is applied.

### 2. CDM model → physical schema mapping

Define a deterministic mapping from CDM model ids to table names and columns. Example:

* `cdm.work.project` → table `${schema}.cdm_work_project`
* `cdm.work.user` → `${schema}.cdm_work_user`
* `cdm.work.item` → `${schema}.cdm_work_item`
* `cdm.work.comment` → `${schema}.cdm_work_comment`
* `cdm.work.worklog` → `${schema}.cdm_work_worklog`

Columns mirror CDM fields plus internal plumbing fields:

For `cdm.work.item`:

* `cdm_id` (PK, text)
* `source_system` (text)
* `source_issue_key` (text)
* `project_cdm_id` (text, FK-ish)
* `reporter_cdm_id` (text)
* `assignee_cdm_id` (text)
* `issue_type` (text)
* `status` (text)
* `status_category` (text)
* `priority` (text)
* `summary` (text)
* `description` (text)
* `labels` (text[] or JSON)
* `created_at`, `updated_at`, `closed_at` (timestamp)
* `properties` (jsonb)

Similar mapping for `project`, `user`, `comment`, `worklog`.

Autoprovision DDL must be:

* Idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
* Scoped under a configurable schema (default `cdm_work`).

### 3. Autoprovision operation

Introduce an operation accessible from TS/GraphQL and the worker, e.g.:

* GraphQL mutation:

  * `provisionCdmSink(input: { sinkEndpointId: ID!, cdmModelId: String! })`
* or a CLI/automation call that triggers the same code path.

Behavior:

1. Validate:

   * sink endpoint exists and supports CDM.
   * `cdmModelId` is one of the sink’s `supported_cdm_models`.

2. Connect to the sink’s backing Postgres.

3. Compute target table name and DDL for `cdmModelId`.

4. Apply DDL (idempotent).

5. Register or update a dataset in the metadata catalog representing the CDM table:

   * For example, create/update a `catalog.dataset` record with:

     * `dataset_id = "cdm.work.item"` + sink id suffix (or a canonical id),
     * `physical_location = <schema.table>`,
     * `domain = "cdm.work"`,
     * `labels` indicating `cdm_model_id` and sink endpoint id.

6. Return details (e.g., table name, dataset id) to caller.

The autoprovision operation should be re-runnable without harm.

### 4. Ingestion → CDM sink integration

Ingestion configs that choose:

* `mode = "cdm"`
* and a sink endpoint whose capabilities include the desired `cdm_model_id`

must:

1. Require that autoprovision has been run (or optionally auto-run once if that is safe—v1 can simply require manual autoprovision).
2. In the ingestion worker, for each CDM-mode unit:

   * Use the CDM mapper (from `cdm-core-model-and-semantic-binding-v1`) to transform records into CDM rows.
   * Call the CDM sink endpoint with:

     * `cdm_model_id`
     * iterable of CDM rows.
   * Sink writes into the provisioned table.

This slug does **not** need to change UI beyond maybe exposing a simple indicator that the sink is provisioned. A richer CDM data UI should be a separate slug.

### 5. Metadata catalog integration

After autoprovision:

* The new CDM dataset(s) must appear in the catalog like any other dataset, e.g., `cdm_work.cdm_work_item`.
* Existing catalog and preview mechanisms should work for these tables:

  * The Postgres schema and table should be visible to JDBC metadata ingestion (catalog collection).
  * The dataset detail view should eventually allow preview; enabling that is covered by existing catalog/preview behavior.

It is sufficient in this slug to:

* ensure that autoprovision creates the table, and
* either:

  * directly writes a `catalog.dataset`-style record, or
  * triggers a catalog collection run that discovers it (simpler path: rely on existing JDBC metadata collection once the schema/table exists).

## Data & State

* New physical tables in the sink database (e.g., Postgres) for CDM work models.
* New dataset entries representing those tables in the catalog (via normal collection or explicit upsert).
* No changes to KB schema.

## Constraints

* Autoprovision must be idempotent and safe to rerun.
* CDM sink endpoint should use existing connection management infra (no bespoke DB clients).
* Raw sinks and ingestion flows must behave exactly as before when not using CDM sink endpoints.

## Acceptance Mapping

* AC1 → CDM sink endpoint template exists and advertises CDM capabilities.
* AC2 → Autoprovision creates the correct CDM tables (DDL) and can be safely re-run.
* AC3 → CDM tables appear in the catalog as datasets (either via direct registration or subsequent metadata collection).
* AC4 → CDM-mode ingestion can write to a CDM sink and succeed without impacting raw ingestion flows.

## Risks / Open Questions

* R1: Where CDM tables live (metadata DB vs separate warehouse). For v1 we assume a Postgres-backed internal sink; later we can generalize.
* R2: Multiple CDM sinks with overlapping models: we rely on dataset ids and namespacing to disambiguate.
* Q1: Whether autoprovision is invoked manually (button/CLI) vs automatically when an ingestion config is saved in CDM mode. For v1 it is safer to require an explicit autoprovision step.
