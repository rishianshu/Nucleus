- title: Catalog view bugfixes v0.1 (sidebar, scrolling, endpoint filter, preview)
- slug: catalog-view-bugfixes-v0-1
- type: bug
- context:
  - apps/metadata-console (Nucleus sidebar + Catalog/Endpoints/Collections views)
  - apps/metadata-api (collection run status + preview APIs)
  - docs/meta/ADR-UI-Actions-and-States.md
  - docs/meta/ADR-Data-Loading-and-Pagination.md
  - intents/catalog-view-and-ux-v1/*
- why_now: After implementing the first pass of the Catalog & console UX, several concrete issues remain: sidebar compresses badly, scrolling the main page scrolls the vertical menus, fake endpoints show “successful” collections, the endpoint dropdown in Catalog is incomplete and non-searchable, and preview is effectively always unavailable. These undermine user trust and must be fixed before we build on top of Catalog.
- scope_in:
  - Fix sidebar layout in compressed/narrow mode:
    - keep icon rail and workspace sidebar visually intact;
    - ensure vertical scrolling does not affect the nav rails.
  - Fix scroll behavior:
    - sidebar + icon rail remain fixed;
    - only main content scrolls.
  - Harden collection success vs failure for endpoints:
    - manual collection runs must not show “Succeeded” for clearly invalid endpoints;
    - surface errors in UI via ADR-UI patterns.
  - Improve Catalog endpoint filter:
    - endpoint dropdown must show *all* endpoints (or be asynchronously searchable), not only a limited first page;
    - search/filter should allow typing to find endpoints.
  - Improve preview availability reporting:
    - distinguish between “endpoint lacks preview capability” vs “dataset unlinked” vs “preview failed”;
    - eliminate the “always unavailable” feel by wiring the correct states.
- scope_out:
  - Implementing new preview/profile workflows (still future slug, this bugfix only corrects current wiring/states).
  - New features in Catalog (e.g. label editing, advanced filters).
- acceptance:
  1. Sidebar and icon rail look correct in compressed window; nav does not scroll with content.
  2. Collections on obviously fake endpoints do not report “Succeeded”; failures surface as FAILED with UI errors.
  3. Catalog endpoint dropdown becomes a searchable combo box that can find endpoints beyond the initial small set.
  4. Endpoint filter refreshes when search changes; endpoint list is consistent with datasets being shown.
  5. Dataset preview section shows correct reasons for unavailability (no capability, unlinked dataset, or real error), rather than a generic permanent “unavailable”.
- constraints:
  - No breaking GraphQL changes; fixes are in UI logic and collection runner behavior.
  - Respect ADR-UI-Actions-and-States and ADR-Data-Loading.
  - Keep `make ci-check` within limits.
- non_negotiables:
  - We must not show “SUCCEEDED” for collections where ingestion clearly never ran or failed.
  - Sidebar UX must not degrade in narrow or compressed layouts.
- refs:
  - catalog-view-and-ux-v1 artifacts
  - metadata-identity-hardening (for dataset identity)
- status: in-progress