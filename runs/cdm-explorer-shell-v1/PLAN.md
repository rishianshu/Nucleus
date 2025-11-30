# Plan — cdm-explorer-shell-v1

1. **Understand current Work Explorer + docs CDM data**
   - Review existing Work Explorer components/routes and GraphQL queries to identify what must be refactored.
   - Inspect docs CDM GraphQL and sink data availability (cdmDocItems, etc.).
2. **Design + implement backend CDM entity envelope**
   - Add `CdmDomain`, `CdmEntity`, `CdmEntityFilter`, `CdmEntityConnection`, `cdmEntities`, and `cdmEntity` to the GraphQL schema.
   - Map queries to existing CDM sinks (work + docs) without breaking existing endpoints; add unit/integration tests covering both domains.
3. **Build CDM Explorer shell in Metadata UI**
   - Introduce `/cdm` route + sidebar nav entry.
   - Create shell component that loads plugins, handles shared search/pagination, and renders Work + Docs tabs.
   - Refactor Work Explorer into a plugin without regressing functionality.
4. **Implement Docs plugin**
   - Use docs CDM data (via the new envelope/query) to render list, filters (source system, space, search), and detail view with source links.
   - Ensure docs tab gracefully handles empty state.
5. **Testing + docs**
   - Update unit/integration tests (GraphQL + UI) and add/adjust Playwright scenarios for the new shell/tabs.
   - Document the CDM Explorer shell and future domain plugin pattern in architecture docs.
