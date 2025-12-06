# SPEC — OneDrive delegated auth v1 (browser sign-in)

## Problem

The current OneDrive connector is designed around app-only auth and a stubbed Graph harness for CI. This is ideal for automated testing but not sufficient for real-world validation:

- Developers/admins often only have personal or team-level OneDrive access, not org-wide Graph admin consent.
- They log in with username/password/MFA in the browser, not with client credentials.
- We need a way to connect “My OneDrive” to Nucleus to validate config, preview, and ingestion before asking for tenant-level permissions.

We must add a delegated auth mode (per-user, browser login) alongside the existing stub/app modes.

## Interfaces / Contracts

### 1. Endpoint descriptor changes

Extend the OneDrive endpoint template with an `authMode` and delegated auth status:

```ts
type OneDriveAuthMode = "stub" | "app" | "delegated";

type OneDriveEndpointConfig = {
  authMode: OneDriveAuthMode;
  // For stub/app:
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  // For both:
  driveSelector?: "me" | "site" | "driveId";
  rootPath?: string;
  // Delegated runtime status (read-only in UI):
  delegatedConnected?: boolean;
};

	•	authMode=stub: use local stub base URL (for CI/dev).
	•	authMode=app: (future) use client credentials.
	•	authMode=delegated: use per-user tokens acquired via browser sign-in.

The UI:
	•	Shows authMode as a selectable field (stub/delegated).
	•	When delegated is selected, shows a “Connect OneDrive” button to start the auth flow.

2. Delegated auth flow (browser)

Use OAuth2 Authorization Code flow with PKCE or standard code flow, depending on libs used:

GraphQL / REST endpoints (conceptual):
	1.	startOneDriveAuth(endpointId: ID!): OneDriveAuthSession!
	•	Creates an auth session:
	•	Generates state and code_verifier (if PKCE).
	•	Builds an authorization URL to Microsoft login with:
	•	client_id (public),
	•	redirect_uri = metadata-api callback,
	•	scope = offline_access Files.Read.All (or more restricted),
	•	response_type = code,
	•	state.
	•	Stores state (+ PKCE details) in a short-lived server-side store keyed by authSessionId.
	•	Returns:
	•	authSessionId,
	•	authUrl (for UI to redirect/open in new window).
	2.	GET /auth/onedrive/callback?code=...&state=...
	•	Validates state.
	•	Exchanges code for tokens via Azure AD token endpoint.
	•	Stores:
	•	access_token (short-lived),
	•	refresh_token (long-lived),
	•	expiry,
	•	associated endpointId and Nucleus user id (for auditing).
	•	Marks the endpoint as delegatedConnected=true in its config/status.
	•	Redirects back to the UI (e.g., /metadata/endpoints/:id?onedriveConnected=1).

UI behavior:
	•	“Connect OneDrive” button calls startOneDriveAuth.
	•	UI opens authUrl in a new window/tab.
	•	After callback, UI polls or refreshes to see updated delegatedConnected=true.

3. Using delegated tokens in SourceEndpoint

For authMode=delegated, the OneDrive SourceEndpoint must:
	•	Resolve tokens from a secure store (e.g., DB table keyed by endpointId):

tokens = token_store.get_onedrive_tokens(endpoint_id)
access_token = ensure_fresh_access_token(tokens)  # refresh if expired


	•	Set Authorization: Bearer <access_token> on Graph API calls.
	•	Not rely on tenantId/clientId/secret for the data plane (though they may still exist on the app registration).

The ingestion worker:
	•	Receives endpointId and authMode.
	•	For delegated, uses delegated tokens; for stub, uses stub base URL; for app (future), uses client credentials.

4. CI and stub mode

For CI/pipeline runs:
	•	authMode must default to stub.
	•	The stub Graph base URL is set via env/config (e.g., ONEDRIVE_GRAPH_BASE_URL=http://localhost:8805).
	•	Tests:
	•	Do not require delegated auth to be configured.
	•	Only assert that the delegated fields/mutations exist and that UI surfaces them, not that real Graph is reachable.

Data & State
	•	Tokens storage:
	•	A secure table or KV entry keyed by (endpointId, authMode="delegated") containing:
	•	refresh_token,
	•	last_access_token + expiry,
	•	scopes and tenant info.
	•	Tokens must be encrypted at rest if possible; at minimum, not logged.
	•	Endpoint config:
	•	Stores authMode and a delegatedConnected flag.
	•	Does not store raw access/refresh tokens.

Constraints
	•	GraphQL schema changes must be additive:
	•	New mutations (e.g., startOneDriveAuth),
	•	New fields on endpoint types (e.g., authMode, delegatedConnected).
	•	No direct rendering of secrets or tokens in GraphQL responses.
	•	For v1, we can assume a single-tenant environment; multi-tenant tenantId mapping can be deferred.

Acceptance Mapping
	•	AC1 → OneDrive endpoint supports authMode and stub/delegated both exist.
	•	AC2 → Browser sign-in flow is implemented, tokens stored, and endpoint shows delegatedConnected.
	•	AC3 → Preview and ingestion for authMode=delegated use delegated tokens.
	•	AC4 → Stub mode remains default, CI uses stub only.
	•	AC5 → pnpm ci-check remains green.

Risks / Open Questions
	•	R1: Token storage security; for v1 we rely on existing secret storage and keep scope narrow.
	•	R2: Multi-user behavior (multiple people connecting the same endpoint); v1 can treat endpoints as owned by a single admin user.
	•	Q1: Whether to permit both delegated and app modes on the same endpoint in the future; v1 can keep these modes mutually exclusive per endpoint.
