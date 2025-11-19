✅ intents/catalog-view-and-ux-v1/SPEC.md

# SPEC — Catalog View & Console UX v1

## Problem
The Catalog view currently loads the entire dataset universe, endpoint filters match by string, UI actions give no feedback, and dataset detail is missing. The console needs a unified UX foundation to make data ingestion and browsing predictable.

This SPEC applies **ADR-UI-Actions-and-States** and **ADR-Data-Loading-and-Pagination** to the Catalog and related views.

---

## Interfaces / Contracts

### 1. GraphQL Contracts (Additive)

Extend existing dataset query (`catalogDatasets` or equivalent) with:

catalogDatasets(
endpointId: ID
search: String
labels: [String!]
first: Int
after: String
): DatasetConnection!

- Must support cursor pagination.
- Must filter by endpoint ID directly (using the correct link from MetadataRecord → endpoint).
- Search must operate on dataset name (`schema.table`) and/or label text.

**Dataset detail query** (if not available):

dataset(id: ID!): Dataset

Returns:

- id
- endpointId + endpoint displayName
- schema/table
- labels
- columns list (name, type, nullable, description)
- lastCollectionRun (timestamp, status)
- preview/profile capability flags

### 2. Catalog List View (Client)

Must follow **ADR-Data-Loading-and-Pagination**:

- Paginated (default 25–50 per page)
- Search with debounce
- Filters push new GraphQL query
- States:
  - loading skeleton
  - error banner (+ retry)
  - empty state
  - data rows/cards

Dataset row/card MUST show:

- schema.table
- endpoint displayName
- labels (if present)
- last run status chip (optional but recommended)

### 3. Dataset Detail View

Route: `/catalog/datasets/:datasetId`

Sections:

1. **Header**
   - Name (schema.table)
   - Endpoint link
   - Labels (chips)
   - Last collection timestamp + chip

2. **Columns Table**
   - name, type, nullable, description

3. **Preview Section**
   - If endpoint lacks `preview` → “Preview not supported”
   - If supported but never run → show “Run preview” button
   - If preview in progress → spinner + status
   - If succeeded → render sample rows
   - If failed → render error message

4. **Profile Section**
   - If endpoint lacks `profiles` → “Profiling not supported”
   - If exists but empty → “Not yet profiled”
   - If available → render minimal stats (if available)

5. **Related Runs (optional)**
   - Last N runs linking to Collections page

### 4. Action Feedback

All async actions follow **ADR-UI-Actions-and-States**:

- Trigger collection:
  - local: spinner + button disabled
  - global: toast success/error
- Dataset detail navigation:
  - local: “Opening…” while fetching
  - global: toast on error
- Collections → Endpoint navigation:
  - local + global handling as above

### 5. State Management & Hooks

- Provide or reuse shared hooks:
  - `useAsyncAction()` → wraps mutations and provides UI states
  - `usePagedQuery()` / `useListQuery()` → handles pagination, filters, error/loading as per ADR

Hooks must be reusable across console views.

---

## Data & State

- Dataset identity is stable (from `metadata-identity-hardening`).
- Filters operate on:
  - endpointId (from labels/payload)
  - search text
  - labels array
- Backend returns paginated data; client must NOT attempt to load entire dataset list.

---

## Constraints

- GraphQL changes are additive only.
- Preview/profile NOT required to be wired to Temporal yet.
- All UI follow ADR-UI and ADR-DataLoading.
- No silent failures; navigation errors must show toast or banner.

---

## Acceptance Mapping

- AC1 → Action feedback pattern on Trigger collection + navigation
- AC2 → Catalog pagination + data loading following ADR
- AC3 → Endpoint filter correctness (ID-based)
- AC4 → Dataset detail page routes & fields
- AC5 → Preview/profile state messaging
- AC6 → Robust navigation with feedback when loading or failing

---

## Risks / Open Questions

- Server support for cursor pagination may require minor GraphQL resolver updates.
- Preview/profile UI must tolerate partial or missing backend fields.
- Long-term: Should labels be user-editable? (Out of scope)
