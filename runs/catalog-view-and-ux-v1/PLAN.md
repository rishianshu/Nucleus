# Plan — catalog-view-and-ux-v1

1. **GraphQL & data layer groundwork**
   - Add cursor-based `catalogDatasetConnection` (or equivalent) to `apps/metadata-api/src/schema.ts` exposing `first/after/search/endpointId/labels` arguments while keeping the legacy `catalogDatasets` list for compatibility. Implement pagination via Prisma so we no longer materialize the whole catalog (AC2/AC3).
   - Ensure dataset detail query returns the required fields (endpoint link, columns, labels, last collection run metadata) and expose capability hints needed for preview/profile placeholders (AC4/AC5).
   - Update the metadata client to consume the new query shape so UI hooks have typed helpers.

2. **Shared hooks & action feedback (ADR-aligned)**
   - Implement `useAsyncAction` + `usePagedQuery` (or equivalent hooks) inside `apps/metadata-ui/src/metadata/hooks/` to encapsulate ADR-UI action states and ADR-Data-Loading patterns (loading skeleton, retry, error banner, empty states). Wire trigger-collection + navigation paths through these hooks (AC1/AC6).

3. **Catalog list refactor**
   - Replace the existing in-memory filtering logic in `MetadataWorkspace` with the paginated hook (search debounce, endpoint filter tied to ID, label filter). Render pagination controls + states exactly as ADR requires, ensuring we only hold page-sized results (AC2/AC3/AC7).

4. **Dataset detail experience**
   - Add `/catalog/datasets/:datasetId` route/component that fetches detail via GraphQL and renders the required sections (header, columns, last collection info, preview/profile placeholders) plus navigation breadcrumbs/toasts (AC4/AC5/AC6).

5. **Navigations & toasts**
   - Apply the shared action hook to Collections → Endpoint and Catalog → Dataset transitions (buttons/links), surfacing local loading states and toasts on success/error per ADR-UI (AC1/AC6).

6. **Tests**
   - Extend integration tests for catalog pagination/filter accuracy (endpointId, search resets page).
   - Update/extend Playwright specs to cover action feedback, dataset detail view, preview states, and navigation robustness (AC1–AC7 evidence).
