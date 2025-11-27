# SPEC — CDM ingestion modes & sink capabilities v1

## Problem

We now have:

- CDM work models (item, project, user, comment, worklog, etc.).
- Jira→CDM mapping helpers.
- Jira ingestion units exposing `cdm_model_id` metadata.

But ingestion still:

- treats all units as “raw mode” (source-shaped payloads),
- has no explicit `mode` field in the config,
- and does not validate whether a chosen sink can accept CDM rows.

We want ingestion to support **two explicit modes** for eligible units:

- `"raw"`: store source-shaped records (today’s behavior).
- `"cdm"`: apply CDM mapping before writing rows to a CDM-capable sink.

This must be:

- visible in the UI,
- stored in the ingestion config,
- enforced in the Python ingestion pipeline,
- and gated by source & sink capabilities.

## Interfaces / Contracts

### 1. Ingestion unit config: add `mode` field

#### 1.1. Config data model (TS / Prisma)

Extend the ingestion unit configuration model (naming may differ):

```ts
// Conceptual TypeScript shape for ingestion unit config
export type IngestionMode = "raw" | "cdm";

export interface IngestionUnitConfig {
  unitId: string;
  sourceEndpointId: string;
  sinkEndpointId: string;
  mode: IngestionMode;                // NEW
  cdmModelId?: string;                // already available from unit descriptor
  // ... existing fields (schedule, filters, etc.)
}
````

Persistence:

* Add a `mode` column/field to the ingestion unit config table/entity.
* Migration rule: existing rows gain `mode = "raw"`.

GraphQL:

* Update ingestion config input and output types to include `mode` when the underlying unit has a `cdm_model_id`:

  * For GraphQL, we can either:

    * always include `mode` (with `"raw"` default), or
    * include `mode` and `cdmModelId` fields and rely on client logic to hide them when not applicable.

#### 1.2. Source unit CDM metadata

We already use `cdm_model_id` inside ingestion unit descriptors (from `cdm-core-model-and-semantic-binding-v1`). This slug simply reads that metadata and surfaces it in config/GraphQL/UI as:

* `cdmModelId` (read-only metadata about the unit),
* `mode` (user choice: raw vs cdm).

### 2. Sink capabilities

Extend sink endpoint descriptors with CDM capabilities. Conceptually:

```ts
interface SinkCapabilities {
  supportsRaw: boolean;
  supportedCdmModels?: string[];  // e.g., ["cdm.work.item", "cdm.work.project"]
}
```

Implementation details:

* Extend sink endpoint descriptor (TS side) to include `cdmSupport: string[]` (list of supported CDM model ids).
* For internal CDM sinks (later), this might be a long list; for generic sinks (e.g. a JDBC sink configured to host CDM tables), it might be limited.

This slug only needs:

* at least one sink endpoint that declares support for relevant CDM models (e.g., `cdm.work.item`),
* clear capability check rules in validation.

### 3. UI behavior

In the ingestion configuration UI:

1. When selecting a **source unit**, UI fetches:

   * its `cdmModelId` (if any),
   * current `mode` (from config),
   * candidate sink endpoints and their CDM capabilities.

2. If `cdmModelId` is undefined:

   * Do not show CDM mode options.
   * Force `mode = "raw"`.

3. If `cdmModelId` is defined:

   * Show a simple selector:

     * “Store raw source data” (`mode = "raw"`)
     * “Apply CDM mapping (`<cdmModelId>`) before storing” (`mode = "cdm"`).
   * When `mode = "cdm"`:

     * Show only sinks that declare support for this `cdmModelId` (or at least for its category, e.g. `cdm.work.*`).
     * If user changes sink to a non-compatible one, reset mode to `"raw"` or show a validation error.

4. Validation:

* When saving ingestion config:

  * If `mode = "cdm"`:

    * assert `cdmModelId` is present for the unit;
    * assert chosen sink’s capabilities include that `cdmModelId` (or a compatible pattern).
  * Otherwise, reject with a clear error message: e.g., `"CDM mode requires a source unit with cdm_model_id and a sink that supports that CDM model"`.

### 4. Python ingestion worker behavior

In the ingestion worker (Python), for each run:

* The worker receives an `IngestionUnitRunConfig` including:

  * `unit_id`,
  * `source_endpoint_id`,
  * `sink_endpoint_id`,
  * `mode` (`"raw"` or `"cdm"`),
  * `cdm_model_id` (if present),
  * checkpoint, filters, etc.

Data-plane flow remains:

```text
SourceEndpoint → StagingProvider → (Transform) → SinkEndpoint
```

**Raw mode:**

* `mode == "raw"`:

  * The worker reads from the source unit as it does today (normalized source-shaped records).
  * It passes those records directly to the sink driver.
  * No CDM mapping is performed.

**CDM mode:**

* `mode == "cdm"`:

  * The worker asserts:

    * unit has `cdm_model_id`,
    * mapping module exists for that CDM model and source type (e.g., Jira→CdmWorkItem).
  * It inserts a transformation step between Source and Sink:

    * calls the appropriate mapper from `runtime_core/cdm` / Jira mapping module.
    * yields CDM work instances (e.g., `CdmWorkItem` dataclasses).
  * The sink driver receives CDM-shaped rows:

    * It may write them to a CDM-specific table/collection later; for this slug, we only ensure the transformation occurs and that the sink sees CDM-typed rows.

Important:

* Mapping must occur entirely inside Python, not via TS/GraphQL.
* There is no change to Temporal activity signatures, beyond including the `mode` and `cdm_model_id` fields in the config payload.

### 5. Capability matrix & validation

Add documentation and, optionally, a small helper to compute:

* For each **source unit**:

  * `cdm_model_id` (if any).
* For each **sink endpoint**:

  * `supportedCdmModels`.

Validation rules for config creation/update:

* If `mode = "raw"`:

  * Require only that source and sink endpoints exist.
* If `mode = "cdm"`:

  * Require `cdm_model_id` on the source unit.
  * Require `supportedCdmModels` on the sink endpoint to include that model id (or a compatible pattern).
  * Otherwise, reject.

Docs:

* `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md`:

  * update to include a “CDM ingestion” section summarizing:

    * how `mode` works,
    * how sources/sinks advertise CDM support,
    * the current set of source units and sink endpoints that support CDM v1.

## Data & State

* Ingestion unit configuration gains a `mode` field.
* All existing configs default to `mode = "raw"` via migration or default values.
* No changes to KB or CDM sinks in this slug.

## Constraints

* No DB schema changes beyond adding the `mode` field to ingestion unit config.
* No changes to catalog or KB schema.
* No new Temporal workflows; reuse existing ingestion run workflow.

## Acceptance Mapping

* AC1 → `mode` field exists on ingestion unit config and defaults to `"raw"` for legacy configs.
* AC2 → UI shows `mode` selection only when `cdmModelId` is present and validates source/sink compatibility.
* AC3 → Python ingestion worker applies CDM mapping when `mode="cdm"` and unit/sink support it; otherwise, raw path is preserved.
* AC4 → Documentation for CDM ingestion capabilities and validation rules is added.

## Risks / Open Questions

* R1: The CDM transform may be more expensive than raw mode; this slug does not introduce performance optimizations or batching beyond what existing ingestion already supports.
* R2: Future sources might want partial CDM (e.g., items but no comments); we rely on `cdm_model_id` per unit to express that granularity.

