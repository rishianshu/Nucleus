# Story — endpoint-lifecycle

- 2025-11-12: Codex aligned metadata API/UI/tests for endpoint lifecycle; ci-check (Playwright) green.
- 2025-11-14: Codex blocked on verifying updated ACCEPTANCE because the `endpoints(projectSlug)` GraphQL/UI feed never surfaces newly created endpoints (despite `metadataEndpoints` containing them); awaiting guidance on the correct project/tenant contract.
- 2025-11-14: Codex completed the Endpoint Lifecycle intent with soft-delete-aware API, expanded Playwright CI (auto-collect, bad credentials, UI-state contract), and captured evidence for AC1–AC6 with ci-check + metadata-auth passing.
- 2025-11-15: Codex fixed the metadata overview query regression, reran `corepack pnpm check:metadata-auth` + `make ci-check`, and documented ACCEPTANCE AC1–AC6 evidence (tests/metadata-auth.spec.ts, tests/metadata-lifecycle.spec.ts) to confirm the feature is complete.
