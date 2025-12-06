# STORY — onedrive-delegated-auth-v1

- 2025-12-06T04:34Z: Added OneDrive delegated auth mode (auth_mode stub/delegated), GraphQL start/callback with optional real token exchange + persisted delegatedConnected status, UI connect button/status, runtime ingestion/preview consume delegated tokens, and METADATA_FAKE_COLLECTIONS=1 pnpm ci-check green.
- 2025-12-06T06:21Z: Hid OneDrive tenant/client credential fields when auth_mode=delegated, clarified delegated panel copy, and rebuilt metadata-api/ui (tsc+vite) to verify.
- 2025-12-06T06:53Z: Reordered OneDrive form fields, improved drive/base URL help, allowed delegated endpoints to save before test to enable Connect, and rebuilt metadata-api/ui.
- 2025-12-06T07:18Z: Re-exposed tenant/client/secret for delegated, delegated auth now uses endpoint client/tenant settings, UI blocks stub client_id, and api/ui builds green.
