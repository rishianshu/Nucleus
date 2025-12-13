# SPEC — UCL gRPC Capabilities and Auth Descriptors v1

## Problem

We need a hardened, extensible connector layer:

- metadata-api must be endpoint-agnostic and decide valid actions by capability probing,
  not by connector-family conditional logic.
- Workspace needs to authenticate users with their profile; endpoints should advertise
  auth modes (service auth vs delegated/social login) and required scopes.
- Long-running connector operations must not rely on large payloads through Temporal
  messages. UCL should run long workflows internally via Temporal, and expose state
  via gRPC.

Without these contracts, adding new sources (Git, Slack, Drive, etc.) will drift and
UI will show false-success states or inconsistent behavior.

## Interfaces / Contracts

### A) Capability handshake (gRPC)

UCL exposes a capability probe that can be called using either:
- a templateId (pre-registration) or
- an endpointId/sourceId (post-registration).

**Conceptual RPCs (proto names indicative):**
- `GetTemplate(templateId) -> TemplateDescriptor`
- `GetEndpoint(endpointId) -> EndpointDescriptor`
- `ProbeCapabilities(input) -> CapabilityProbeResult`

**CapabilityProbeResult:**
- `capabilities[]` (strings)
- `constraints` (optional JSON map)
- `authRequirements` (scopes, modes)
- `supportedOperations[]` (enumerated operations)

**Standard capability keys (examples; additive):**
- `endpoint.test_connection`
- `metadata.plan`
- `metadata.run`
- `preview.plan`
- `preview.run`
- `ingestion.plan`
- `ingestion.run`
- `auth.service`
- `auth.delegated.device_code`
- `auth.delegated.auth_code_pkce`

Rules:
- metadata-api must treat actions as valid ONLY if both:
  - operation is supported by capability probe, and
  - auth requirements can be satisfied.

### B) Auth descriptors in template descriptors

Endpoint templates must advertise supported authentication modes and UX hints.
This is required for Workspace to initiate user authentication.

Add the following JSON structure inside the template descriptor (exact storage is JSON in DB):

```json
{
  "auth": {
    "modes": [
      {
        "mode": "service",
        "label": "API Token / Client Credentials",
        "requiredFields": ["token"] ,
        "scopes": [],
        "interactive": false
      },
      {
        "mode": "delegated_device_code",
        "label": "Sign in with Microsoft",
        "requiredFields": [],
        "scopes": ["Files.Read.All"],
        "interactive": true
      },
      {
        "mode": "delegated_auth_code_pkce",
        "label": "Sign in with Atlassian",
        "requiredFields": [],
        "scopes": ["read:jira-work"],
        "interactive": true
      }
    ],
    "profileBinding": {
      "supported": true,
      "principalKinds": ["user"],
      "notes": "Used by Workspace to bind connector access to a user profile"
    }
  }
}
```

Semantics:

* `interactive=true` indicates Workspace may show a "Sign in" button.
* `scopes` provide UI hints + validation requirements.
* `profileBinding.supported=true` indicates this endpoint can be associated with a user principal.

### C) Long-running operations contract

UCL exposes a consistent model for long-running connector work.

RPCs:

* `StartOperation(StartOperationRequest) -> StartOperationResponse`
* `GetOperation(operationId) -> OperationState`
* `ListOperationEvents(operationId) -> stream OperationEvent` (optional v1; can be polling-only)

Operation kinds:

* `METADATA_RUN`
* `PREVIEW_RUN`
* `INGESTION_RUN`

OperationState fields:

* `operationId`
* `status` = QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED
* `startedAt`, `completedAt`
* `retryable` (bool)
* `error` { code, message, detailsJson }
* `stats` { counters, bytes, rows, pages, etc. }

Execution:

* UCL runs the implementation via **Temporal workflows inside UCL**, not inside metadata-api.
* metadata-api triggers `StartOperation` and then maps `OperationState.status` to its own run tables.

### D) Error model (hardening)

All UCL gRPC responses MUST follow a structured error model.

Minimum error codes (examples):

* `E_AUTH_REQUIRED`
* `E_AUTH_INVALID`
* `E_SCOPE_MISSING`
* `E_ENDPOINT_UNREACHABLE`
* `E_TIMEOUT`
* `E_RATE_LIMITED`
* `E_INVALID_CONFIG`
* `E_UNSUPPORTED_OPERATION`

Each error includes:

* `retryable`: boolean
* `requiredScopes`: optional list
* `resolutionHint`: optional string

### E) GraphQL plumbing (metadata-api)

GraphQL must expose template auth descriptors and capability probe results.

Required additions (names indicative):

* `endpointTemplates { id, descriptor }` must include `descriptor.auth`.
* `probeEndpointCapabilities(endpointId|templateId)` returns capability set and constraints.
* Existing UI flows should remain compatible; changes should be additive.

## Data & State

* Template descriptors remain stored in MetadataEndpointTemplate.descriptor (JSON).
* Endpoint records remain stored in metadata DB; UCL is called for capability and operations.
* Operation state may be stored:

  * in UCL (as Temporal workflow state) and accessed via gRPC, and/or
  * mirrored into metadata-api run tables (recommended for UI stability).

Idempotency:

* `StartOperation` should support an optional idempotency key:

  * (tenantId, endpointId, operationKind, requestHash) to avoid duplicate workflows.

## Constraints

* Strict failure behavior:

  * If a token is wrong → test_connection fails; no downstream "success" run state allowed.
  * If host is unreachable → fail with E_ENDPOINT_UNREACHABLE, retryable=true.
  * If scopes missing → fail with E_SCOPE_MISSING, retryable=false (until scopes granted).
* Timeouts:

  * gRPC calls enforce deadlines.
  * Long-running operations enforce max runtime and heartbeat to avoid stuck workflows.

## Acceptance Mapping

* AC1 → capability probe used by metadata-api (unit/integration tests)
* AC2 → template auth descriptor available via GraphQL (unit tests + snapshot)
* AC3 → StartOperation/GetOperation works and is mapped to run state deterministically (integration tests)
* AC4 → negative hardening cases verified (integration tests; Playwright optional)

## Risks / Open Questions

* R1: Temporal ownership boundary

  * Running long workflows inside UCL is clean, but requires stable operation polling.
* R2: Auth UX dependencies

  * Workspace UI is not built here, but descriptors must be correct to avoid future rework.
