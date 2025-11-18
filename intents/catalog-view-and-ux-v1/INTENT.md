- title: Catalog View & Console UX v1
- slug: catalog-view-and-ux-v1
- type: feature
- context:
  - apps/metadata-console (Catalog, Collections, Endpoints pages)
  - apps/metadata-api (GraphQL queries for catalog.dataset)
  - MetadataRecord domain: `catalog.dataset`
  - docs/meta/ADR-UI-Actions-and-States.md
  - docs/meta/ADR-Data-Loading-and-Pagination.md
- why_now: 
    After fixing identity for `catalog.dataset`, the console experiences poor UX: no action feedback, heavy/full-load dataset view, broken filters, “Preview unavailable” always shown, and no dataset detail page. We need a consistent, ADR-based UX baseline for Catalog before we implement preview/profile or Workspace integrations.
- scope_in:
  - Apply ADR-UI-Actions-and-States for:
    - Trigger collection
    - Dataset row actions (future)
    - Catalog → Dataset detail navigation
  - Apply ADR-Data-Loading-and-Pagination for Catalog:
    - pagination, search, filter-by-endpoint, error/empty/loading states
  - Implement catalog filtering correctly using endpoint IDs
  - Add dataset detail route/page:
    - metadata header (schema.table, endpoint, labels)
    - columns table
    - last collection info
    - preview/profile capability-based placeholders
  - Fix Collections → Endpoint and Catalog → Dataset navigations (consistent feedback + error handling)
- scope_out:
  - Preview/profile workflow implementation (separate slug)
  - GraphStore identity migration (future “graph knowledge base” slug)
  - Workspace-specific dashboards or semantic layers
- acceptance:
  1. Actions in Catalog and Endpoint cards exhibit ADR-UI action states (local + global feedback).
  2. Catalog dataset list uses ADR-Data-Loading with pagination, search, filters.
  3. Endpoint filter uses endpoint IDs, not fuzzy name matching.
  4. Dataset detail page exists and shows schema.table, endpoint, labels, columns, last collection, and preview/profile placeholders.
  5. Preview section reflects capability logic (supported / not supported / not run).
  6. Navigations (Collections → Endpoint, Catalog → Dataset) no longer feel flaky, with error feedback if a load fails.
- constraints:
  - No breaking GraphQL changes. Filters and pagination must be additive.
  - Default page size must prevent full-load behavior.
  - All views must follow ADR-UI-Actions-and-States + ADR-Data-Loading.
  - keep `make ci-check` < 8 min
- non_negotiables:
  - No silent UX failures: every async interaction must visibly transition states.
  - Catalog may not load all datasets at once.
  - Filtering logic must be correct & reliable.
- refs:
  - ADR-UI-Actions-and-States
  - ADR-Data-Loading-and-Pagination
  - Existing Catalog & Collections screenshots
- status: in-progress
