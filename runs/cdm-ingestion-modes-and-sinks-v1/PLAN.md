# Plan

1. **Model & schema update** – Add a dedicated data mode column (`raw`/`cdm`) to ingestion unit configs (Prisma + migration), keep legacy run-mode as `runMode`, and surface both through GraphQL/TS types with defaults for existing rows.
2. **Sink/source capability plumbing** – Model sink CDM capability metadata, expose it via GraphQL, and add validation helpers so configs can only save `mode="cdm"` when both source unit and sink advertise support.
3. **UI toggle & validation** – Update the ingestion console to show a Raw vs CDM selector whenever a unit has `cdmModelId`, wire it to the new config fields, and enforce sink filtering/error states before saving.
4. **Worker/runtime wiring** – Thread the new data mode through Temporal activities, teach the Python ingestion worker/sinks to invoke Jira→CDM mapping only when mode is `cdm`, and keep raw mode unchanged.
5. **Docs & automated coverage** – Add capability-matrix docs, unit tests (TS/Py), and end-to-end checks (Playwright/ingestion tests) proving both modes behave per acceptance.
