- title: OneDrive delegated auth v1 (browser sign-in)
- slug: onedrive-delegated-auth-v1
- type: feature
- context:
  - apps/metadata-api (GraphQL schema/resolvers, auth callbacks)
  - apps/metadata-ui (endpoint registration, auth flows)
  - platform/spark-ingestion (endpoints auth config, ingestion runtime)
  - runtime_common/endpoints/http_onedrive.py (or equivalent)
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
- why_now: The OneDrive connector currently targets app-level (client credentials) and stubbed Graph only. To validate the integration before we obtain org-wide Graph permissions, we need a safe, per-user “sign in with Microsoft” path so developers/admins can connect their own OneDrive and run ingestion/preview. This requires a delegated auth mode alongside the existing app/stub modes, with clear UX and no hard dependency on tenant-level consent.
- scope_in:
  - Extend the OneDrive endpoint descriptor with an `authMode` switch (e.g., `stub | app | delegated`).
  - Implement a delegated auth flow (browser-based login) using Microsoft identity (OAuth2 auth code flow).
  - Add metadata-api endpoints/GraphQL mutations to initiate and complete the OneDrive auth handshake and persist tokens securely.
  - Update ingestion and preview to use delegated tokens when `authMode=delegated`.
  - Ensure CI still uses the stub mode (no real Graph or secrets required).
- scope_out:
  - Full multi-user access control (ACL/RLS) over docs — covered by docs-access-graph-and-rls-v1.
  - Complex consent UX for multi-tenant SaaS (v1 can assume a single-tenant dev environment).
  - Org-level app permissions (client credentials) — that path remains in design but is not completed in this slug.
- acceptance:
  1. OneDrive endpoints support an `authMode` with at least `stub` and `delegated`.
  2. Users can start a delegated OneDrive connection from the UI, sign in via browser, and see a “connected” status.
  3. Preview and ingestion for a delegated OneDrive endpoint use the delegated token, not stub/app credentials.
  4. Stub mode remains the default for CI, with no need for real Graph creds.
  5. CI (`pnpm ci-check`) remains green.
- constraints:
  - No secrets (client secret, refresh tokens) should ever leak to logs or UI; store them via existing secret/config mechanisms.
  - GraphQL schema changes must be additive.
  - The same OneDrive endpoint template should handle both stub and delegated modes (no duplicated templates).
- non_negotiables:
  - Delegated tokens are never hard-coded; all secrets pulled from env/secure storage.
  - Ingestion still uses Source → Staging → Sink; delegated auth only affects how the SourceEndpoint gets its token.
- refs:
  - intents/semantic-onedrive-source-v1/*
  - intents/ingestion-strategy-unification-v1/*
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
- status: in-progress
