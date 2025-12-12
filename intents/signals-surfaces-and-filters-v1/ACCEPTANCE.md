# Acceptance Criteria

1) GraphQL signals exploration API  
   - Type: integration  
   - Evidence:
     - The GraphQL schema exposes a `signalInstances` query (and optionally `signalsForEntity`) with:
       - `filter` fields for severity, status, sourceFamily, entityKind, policyKind, definitionSlugs, and from/to.
       - Pagination via `first` and `after`.
     - An integration test issues queries with combinations of filters and asserts:
       - Correct subset of SignalInstances is returned.
       - Unsupported filters are ignored or rejected consistently (per spec).
     - The API returns enough context for each SignalInstance (id, definitionSlug, entityRef, severity, status, timestamps).

2) Signals UI view with filters and navigation  
   - Type: e2e (Playwright)  
   - Evidence:
     - A Playwright test navigates to the Signals view and verifies:
       - Filters for severity, status, sourceFamily, entityKind, policyKind, and definition search are rendered.
       - Toggling filters changes the visible signals in a way consistent with the GraphQL fixtures.
       - Clicking “View entity” navigates to the corresponding CDM work/doc detail page.
       - If `sourceUrl` is present for a signal, an “Open in source” anchor/button is visible with the correct href.

3) CDM detail pages surface signals  
   - Type: e2e (Playwright) / integration  
   - Evidence:
     - For a CDM work item with at least one OPEN SignalInstance:
       - The work item detail page displays an indication of signals (e.g., count + list).
       - A “View all signals” or equivalent link routes to the Signals view with filters pre-set for that entity.
     - Similarly for CDM doc items.
     - Tests verify that entities with no signals either show an empty state or no signals card, but do not error.

4) Backwards compatibility and auth  
   - Type: integration / unit  
   - Evidence:
     - Existing GraphQL queries unrelated to signals continue to work without modification.
     - A test verifies that roles without signals access (if such roles exist) either:
       - Cannot call the signals queries, or
       - See an empty/authorized subset, per existing auth model.
     - No existing UI views break due to the new Signals view being added to the nav.

5) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes after all changes (API, UI, tests).
     - No existing tests are skipped or removed to make this slug pass.
