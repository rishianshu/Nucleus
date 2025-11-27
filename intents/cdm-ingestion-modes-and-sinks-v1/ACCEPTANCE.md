### 3) `intents/cdm-ingestion-modes-and-sinks-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Ingestion unit config supports `mode` with backward compatibility
   - Type: unit / integration
   - Evidence:
     - The ingestion unit configuration model (DB/Prisma + TS) includes a `mode: "raw" | "cdm"` field.
     - A migration or default ensures that existing configs without `mode` behave as `mode = "raw"`.
     - GraphQL ingestion config input/output types expose `mode` and, where applicable, `cdmModelId`.

2) UI exposes Raw vs CDM only when CDM is supported
   - Type: e2e (Playwright) / integration
   - Evidence:
     - For a Jira ingestion unit with `cdm_model_id`:
       - The config UI shows a Raw/CDM mode toggle.
       - When `mode="cdm"`, only sinks that support that CDM model can be selected; attempts to save with an incompatible sink result in a validation error.
     - For an ingestion unit without `cdm_model_id`:
       - No CDM toggle is shown; `mode` is effectively `raw` and not editable.

3) Python ingestion worker applies mapping only in CDM mode
   - Type: unit / integration
   - Evidence:
     - A test configures a Jira unit with:
       - `cdm_model_id = "cdm.work.item"`
       - `mode = "cdm"`
       - a CDM-capable sink.
     - The worker run:
       - invokes the Jira→CDM mapper,
       - hands CDM work entities to the sink driver,
       - does not expose raw Jira shapes to the sink.
     - A similar test with `mode = "raw"` confirms:
       - the mapper is not called,
       - the sink sees raw source-shaped records (existing behavior).

4) Invalid CDM combinations are rejected
   - Type: unit / integration
   - Evidence:
     - If a user tries to:
       - set `mode = "cdm"` on a unit without `cdm_model_id`, or
       - choose a sink that does not support the unit’s `cdm_model_id`,
       - the GraphQL/API layer rejects the config with a clear error message.
     - Corresponding tests cover these failure paths.
````

---

