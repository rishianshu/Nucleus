# OneDrive Endpoint Wizard — Future Requirements

## Goals
- Reduce cognitive load during endpoint registration by guiding users through small, sequenced steps.
- Prevent field bleed-over between templates; keep defaults and labels template-scoped.
- Make delegated auth actionable (save → connect) without blocking on unrelated fields.
- Allow future endpoint-specific behaviors (e.g., Jira project picker, OneDrive folder selection) without cluttering the generic form.

## Scope (v1 wizard)
- Apply to HTTP family endpoints first (OneDrive, Jira, Confluence); keep fallback to existing form.
- Steps:
  1) Template & basics: pick template, set name/labels/description (labels reset to template defaults).
  2) Connection: connection URL/base_url, required identifiers (drive_id), root path/filters.
  3) Auth: auth_mode selector; delegated panel with Connect after save; client/tenant/secret inputs shown when relevant.
  4) Advanced/scope: optional advanced flags and capability extras.
- Save allowed at each step; Connect/Test enabled only after save.

## UX Requirements
- Per-template components: e.g., `<OneDriveEndpointForm>` to render and validate template-specific fields/order.
- Inline help for OneDrive: drive_id (“use ‘me’ or drive GUID”), base_url (“override only for stub/dev”).
- Warnings: block Connect if client_id is stub; prompt for tenant/client when auth_mode=delegated.
- Persist unsaved values per template in memory, but reset labels/defaults on template change to avoid bleed.

## Validation & Data
- Template metadata gains `group`/`stepHint` to support ordering; visibleWhen still honored.
- Save payload stays the same (config.parameters); wizard only changes presentation/gating.
- Tests: Playwright to cover template switch reset, wizard step gating, delegated panel presence, Connect disabled with stub client.

## Rollout Plan
- Phase 1: Introduce per-template component rendering + ordering while keeping single-page layout behind a feature flag.
- Phase 2: Enable stepper UI for HTTP family; add gating for Connect/Test after save.
- Phase 3: Make wizard default after CI green and manual verification; keep fallback toggle for a release.

## Open Questions
- Should we store per-step draft state server-side for multi-user edits? (out of v1)
- Do we preload endpoint-specific lookups (e.g., Jira projects, OneDrive folder tree) during the wizard? (likely v2)
