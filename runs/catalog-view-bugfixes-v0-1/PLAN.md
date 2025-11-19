# Plan — catalog-view-bugfixes-v0-1

1. **Layout & Scroll Fixes (AC1)**
   - Refactor the app shell + metadata workspace wrappers so the outer sidebar/icon rail stay fixed.
   - Ensure only the main content column scrolls (set height/overflow appropriately) and compressed layouts keep icons readable.
   - Add collapse/expand affordances that remain usable in narrow view.

2. **Endpoint Combo + Filter Sync (AC3/AC4)**
   - Replace the catalog endpoint `<select>` with a searchable combo backed by a paginated endpoint query.
   - Keep dataset search + endpoint filter in sync (debounce, reset pagination) and allow clearing the filter.
   - Fold all known endpoints (including those returned with datasets) into the lookup map so preview/filter logic has accurate metadata.

3. **Preview State Wiring (AC5)**
   - Reuse endpoint capabilities + linkage to distinguish unsupported/unlinked/not-run/error states.
   - Update UI copy/buttons to reflect those states and ensure preview button is enabled when supported.

4. **Collection Failure Reporting (AC2)**
   - Tighten server-side collection trigger logic so obviously unreachable endpoints mark runs FAILED (even under bypass/testing).
   - Surface the failure in endpoint cards/toasts per ADR-UI patterns.

5. **Tests & Verification**
   - Update/add unit + Playwright coverage for the new combo, preview states, and collection failure behavior.
   - Run existing suites (metadata-api tsx tests, metadata-ui vitest, metadata-auth Playwright) and fix regressions.
