# Acceptance Criteria

1) OneDrive endpoint supports authMode with stub and delegated
   - Type: integration
   - Evidence:
     - GraphQL endpoint template for OneDrive exposes an `authMode` field with allowed values including `stub` and `delegated`.
     - Updating an endpoint via GraphQL/ UI allows changing `authMode` between `stub` and `delegated` (with appropriate validations).

2) Browser sign-in flow connects OneDrive in delegated mode
   - Type: e2e (Playwright) + integration
   - Evidence:
     - A Playwright test simulates clicking “Connect OneDrive” (or equivalent) for an endpoint with `authMode=delegated`, calls the `startOneDriveAuth` mutation, and verifies that an `authUrl` is returned.
     - Integration tests cover the `/auth/onedrive/callback` handler, asserting:
       - valid `state` is required,
       - a mock token exchange persists tokens and sets `delegatedConnected=true` for the endpoint.

3) Preview and ingestion use delegated tokens for delegated endpoints
   - Type: integration
   - Evidence:
     - In a test harness with mocked token store and Graph client, calling preview on a `authMode=delegated` endpoint:
       - loads tokens from the store,
       - uses them to authorize Graph calls.
     - Starting an ingestion run for a delegated endpoint uses the delegated token path in the SourceEndpoint, not stub/app code, as asserted by mocks.

4) Stub mode remains default for CI
   - Type: meta + integration
   - Evidence:
     - For a newly registered OneDrive endpoint created in CI tests, `authMode` defaults to `stub`.
     - All ingestion and preview tests used in `pnpm ci-check` run with stubbed Graph (no external network, no real credentials).
     - CI configuration does not require any OneDrive secrets.

5) No secrets or tokens leak via GraphQL or logs
   - Type: unit / integration
   - Evidence:
     - GraphQL schema does not expose refresh_token or access_token fields on any type.
     - Tests verify that token storage functions do not log token values (e.g., by stubbing logger and checking).
     - Error responses related to auth do not contain token values.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after adding delegated auth functionality.

