---
title: "UAT Smoke Checklist"
status: draft
owners:
  - platform-tooling
lastUpdated: 2025-11-12
---

## Purpose
Provide a fast, repeatable set of checks that prove the stack is functional after significant changes (auth, infra, schema). These tests cover both products we ship:

- **Jira++ console** (apps/jira-plus-plus)
- **Nucleus / metadata designer** (apps/reporting-designer)

Each app has its own dev server + auth flow, so run the matching tests when touching that surface.

## Test Matrix

| Layer            | Check                                                                 | Command                                     |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Keycloak         | Seeded realm returns a token                                          | `scripts/test-keycloak.sh`                  |
| Jira++ UI        | Keycloak login succeeds, `scrum` route renders                        | `pnpm check:web-auth`                       |
| Metadata UI      | Keycloak login succeeds, metadata nav renders                         | `pnpm check:metadata-auth`                  |
| Metadata API     | Catalog seeded + endpoint lifecycle smoke                             | `pnpm check:metadata-lifecycle`             |
| Core API (4000)  | `health` query returns `status: ok`                                   | `curl -s -H ... http://localhost:4000/...`  |
| Reporting API    | `health` query returns `status: ok`                                   | same pattern on `http://localhost:4002`     |
| Metadata API     | `health` query returns `status: ok`                                   | same pattern on `http://localhost:4010`     |

## UI Feature Coverage
- **Metadata console (Cypress)** – `pnpm test:metadata-ui`
  - Verifies Keycloak login/logout, visible user profile (name/email/role), and the ability to sign out.
  - Ensures Catalog/Endpoints/Collections sections render real datasets and that the registration workspace opens.
  - Exercises dataset preview, dataset detail drawers, and endpoint detail drawers (falls back to the empty-state assertions when no data).
- **Jira++ console** retains the legacy Cypress suite under `cypress/e2e/*.cy.ts` (run with `pnpm cypress run` for full coverage when needed).

## Usage
1. Ensure the relevant dev servers are running via the background scripts (`start-web-bg.sh`, `start-designer-bg.sh`, `start-core-api-bg.sh`, etc.).
2. Run `scripts/verify-uat.sh`. It executes the matrix above (including the API lifecycle smoke) and stops on the first failure, printing the log path for the offending service.
3. Execute `pnpm test:metadata-ui` when you need the richer UI feature validation (or before shipping metadata changes).
4. Fix any failing component and rerun until everything passes.

Only invoke this suite for material changes (auth, infra, backend) or before high‑risk merges; it is heavier than a unit-test loop but still completes in a few minutes.
