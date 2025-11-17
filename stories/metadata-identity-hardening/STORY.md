# Story — metadata-identity-hardening

- 2025-11-16: Booted run and confirmed canonical identity helper/tests exist. `pnpm check:metadata-lifecycle` + helper unit tests pass, but `pnpm check:metadata-auth` fails because the metadata UI requires a reporting `/api/graphql` backend (HTTP 400 banner). Logged blocking question awaiting guidance on how to provide/stub that service before closing the slug.
- 2025-11-17: Guidance clarified there is a single metadata backend (API @4010, UI @5176). Added deterministic `data-testid` attributes to collection run cards, updated the Playwright spec to assert via those attributes, and reran `pnpm check:metadata-auth` successfully.
