### `intents/catalog-view-bugfixes-v0-1/SPEC.md`

```markdown
# SPEC — Catalog view bugfixes v0.1

## Problem
Post `catalog-view-and-ux-v1`, several concrete UX bugs remain:

1. Sidebar + icon rail break visually in compressed viewports and scroll with the main content.
2. Manual collections on invalid/unreachable endpoints still show as `SUCCEEDED`.
3. Catalog endpoint dropdown only shows an initial limited set and is not searchable, so filtering by endpoint is unreliable.
4. Dataset search and endpoint filter feel disconnected.
5. Preview always appears “unavailable” via generic red banners, regardless of actual capability or state.

We need targeted fixes to align implementation with ADRs and the previous SPEC.

---

## Interfaces / Contracts

### 1. Layout & scrolling

- The **workspace sidebar** (left panel with “Metadata / Ingestion / Reconciliation”) and the **icon rail** (inner vertical icons) must be fixed to the viewport.
- Vertical scrolling must occur only within the **main content pane**, not on the nav rails.
- In compressed/narrow view:
  - Sidebar buttons should resize or collapse gracefully (e.g. using min-width and/or icon-only mode).
  - No overlapping or clipping of icons.

Implementation hints (non-binding):

- Use a full-height flex layout:
  - Outer shell: `display: flex; height: 100vh; overflow: hidden;`
  - Sidebar and icon rail: `flex: 0 0 auto;`
  - Main content: `flex: 1 1 auto; overflow-y: auto;`
- Ensure scroll containers are set on main content only.

### 2. Collection success/failure behavior

- Backend / worker must:
  - Mark a run `FAILED` if:
    - endpoint URL/credentials are clearly invalid, or
    - collection job fails before ingesting metadata.
  - Only mark `SUCCEEDED` when:
    - `prepareCollectionJob` returns `kind: "run"` and
    - ingestion / persist steps finish without error.
- UI must:
  - Reflect FAILED vs SUCCEEDED correctly (chips, banners).
  - Use ADR-UI-Actions-and-States for Trigger collection:
    - show error state and toast if run fails quickly.

Implementation options (examples):

- At minimum, if the runner detects a connection or ingestion error, call `markRunFailed` and propagate an error message.

### 3. Catalog endpoint dropdown ⇒ searchable combo

- Instead of a static dropdown populated from the **current page** of endpoints:
  - Implement a **searchable combo box**:
    - fetch endpoints via a dedicated GraphQL query (paginated, filterable by name),
    - allow typing to search endpoints (debounced).
- Requirements:
  - Endpoint combo must be able to find any registered endpoint, not just those preloaded.
  - Selecting an endpoint applies `endpointId` filter to the Catalog dataset query.
  - Clearing the combo removes the filter.

### 4. Sync search and endpoint filters

- When the **search term** changes:
  - Datasets list refetches (per ADR-Data-Loading).
  - If endpoint combo supports search, optionally update endpoint results to reflect matching endpoints (but selection should remain stable unless explicitly changed).
- Behavior must be predictable:
  - Search + endpoint filter together should narrow the dataset list logically (intersection of both conditions).

### 5. Preview state wiring

- Preview UI should distinguish:

  1. **Not supported**:
     - Endpoint has no `preview` capability.
     - Show “Preview not supported for this endpoint” (no button).

  2. **Dataset unlinked**:
     - Dataset is not linked to any endpoint (e.g. labels/fields missing).
     - Show “Link this dataset to a registered endpoint before running previews.” (as you already do, but ensure it only appears in this case).

  3. **Supported but not yet run**:
     - Endpoint supports preview and dataset is linked, but no preview run exists.
     - Show neutral state: “No preview sampled yet. Run preview to inspect data.” + “Run preview” action.

  4. **Error / dataset not found**:
     - Preview API returns error (e.g. underlying dataset missing).
     - Show explicit error state “Dataset not found” or similar, only when backend signals this.

- For this bugfix, full Temporal preview runs are not required; we mostly need:
  - Correct mapping of capabilities and linkage to UI states.
  - Back-end to not collapse all cases into “Dataset not found”.

---

## Data & State

- Layout changes are frontend-only.
- Collection success/failure relies on existing run model; no DB schema changes required, only stricter use of `markRunFailed` vs `markRunCompleted`.
- Endpoint combo uses server-side endpoint listing; this may require:
  - a dedicated `endpoints` query with pagination and `search` argument.

---

## Constraints

- No breaking changes to GraphQL; endpoint search/filter should be additive arguments.
- Keep usage consistent with ADR-UI-Actions-and-States and ADR-Data-Loading-and-Pagination.
- Backend error messages for preview/collections must be sanitized (no secrets).

---

## Acceptance Mapping

- AC1 → Layout & scroll behavior.
- AC2 → Collection success/failure mapping for invalid endpoints.
- AC3 → Searchable endpoint combo + correct filtering.
- AC4 → Linked behavior between dataset search and endpoint filter.
- AC5 → Preview state distinctions.

---

## Risks / Open Questions

- R1: Diagnosing “invalid endpoint” may require network checks or existing connection-test logic; we should at least use whatever info we already have (e.g. failing collection job).
- R2: Endpoint combo might need its own pagination; we should avoid listing thousands of endpoints at once.
- Q1: For preview, do we want a small “dummy” in-memory run just to drive state for now, or only wire to real preview in a later slug?
```

---

