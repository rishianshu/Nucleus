# ADR: Data Loading & Pagination Patterns

- Date: 2025-11-xx
- Status: Active
- Context:
  Nucleus console initially loaded "all the things" (datasets, collections) with ad-hoc filters. As data grows, this becomes slow and confusing. We need a common data loading pattern for lists: Catalog, Collections, Endpoint lists, Workspace views, etc.

- Decision:
  All list views in Nucleus (and later Workspace) MUST use a shared data loading pattern with:
  - pagination and/or incremental loading,
  - server-side filters,
  - explicit loading/error/empty states,
  - a sensible default limit to avoid overloading the server.

## List Model

### Pagination

- Default page size: 25–50 items (exact number configurable per view).
- Pagination model:
  - Cursor-based (`first`/`after`) is preferred; offset-based is acceptable initially if implemented carefully.
- UI MUST:
  - expose page navigation (next/prev or "Load more"),
  - reflect when there is no more data (`hasNext=false`).

### Filters & Search

- Filters must be applied **server-side**, not just client-side, to avoid loading everything.
- When any filter or search term changes:
  - reset to the first page,
  - trigger a new fetch.
- Search/input:
  - must be debounced (e.g. 250–500ms) to avoid flooding the server.

### States

Each list view must represent four core states:

- `loading`: initial fetch or refetch (skeleton or spinner).
- `error`: banner or section with a message + "Retry" action.
- `empty`:
  - no data at all, or
  - no matches for current filters.
- `data`: list of items.

No view should show an infinite spinner without actual network activity.

## Implementation Guidelines

- Provide a shared hook (e.g. `usePagedQuery` / `useListQuery`) that:
  - takes a GraphQL query + variables,
  - manages pagination, filters, and search,
  - exposes `{ items, loading, error, pageInfo, setFilter, setPage }`.
- Each view (Catalog, Collections, etc.) reuses this pattern with its specific query.

## Defaults

- Default `pageSize` MUST be set and used; loading "all records" by default is not allowed in Nucleus/Workspace lists.
- Views may override `pageSize` but must justify it (e.g. small lists).

- Consequences:
  - Predictable performance.
  - Predictable UX across lists.
  - Easier to introduce caching/prefetching later.