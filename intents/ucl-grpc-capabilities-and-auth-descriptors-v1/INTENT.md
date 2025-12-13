title: UCL gRPC Capabilities and Auth Descriptors v1
slug: ucl-grpc-capabilities-and-auth-descriptors-v1
type: feature
context: >
  UCL is the unified connector layer (Go) that replaces the previous language-specific
  endpoint runtime. UCL now exposes gRPC + Temporal activities/workflows. metadata-api
  (GraphQL control plane) should be endpoint-agnostic and rely on capability probing
  rather than connector-family conditionals. Workspace (external app) also needs to
  authenticate users with their profile (delegated auth/social login where applicable),
  which requires the endpoint template descriptors to explicitly advertise supported
  auth modes and UX hints.

why_now: >
  We are entering a hardening phase and need strict capability contracts, consistent
  error/timeout semantics, and a clean separation: metadata-api orchestrates/control
  plane; UCL executes connector-specific work via gRPC and long-running Temporal
  workflows. Without this, new connectors (Git, Slack, etc.) will drift in behavior
  and Workspace cannot reliably complete user-auth flows.

scope_in:
  - Define/implement a gRPC "capability handshake" for endpoints/templates so
    metadata-api can decide which actions are valid (test/metadata/preview/ingest).
  - Add endpoint template descriptor fields for authentication modes:
    - service credentials (client credentials / API token),
    - delegated user auth ("social login" / OAuth device-code / auth-code PKCE),
    - optional per-user profile binding and scope hints.
  - Standardize long-running operations contract:
    - gRPC starts operations and returns operationId,
    - UCL runs the heavy work via Temporal workflows inside UCL,
    - metadata-api polls/reads operation state and maps it to run states.
  - Hardening requirements:
    - timeouts, retryability flags, structured error codes,
    - strict negative cases (bad creds, unreachable host, missing scopes),
    - no false-success collection/preview/ingestion states.

scope_out:
  - No new connector implementation (Jira/Confluence/OneDrive/Git) beyond wiring
    them into the new contracts if needed for tests.
  - No Workspace UI implementation; only descriptor plumbing and API surfaces.
  - No new ingestion pipeline redesign; this slug only hardens control/connector
    contracts and auth descriptors.

acceptance:
  1. metadata-api can probe endpoint/template capabilities via gRPC and no longer
     needs connector-family conditionals to decide allowed actions.
  2. Endpoint templates expose auth descriptors (incl. delegated/social login modes)
     through GraphQL so Workspace can drive auth UX.
  3. Long-running operations run in UCL Temporal workflows and expose consistent
     operation state via gRPC; metadata-api maps these to run states deterministically.
  4. Hardening tests cover strict negative cases (bad creds/unreachable/missing scopes)
     and ensure no false-success UI states are produced.

constraints:
  - Preserve backwards compatibility for existing GraphQL UI flows as much as possible;
    additive schema changes are preferred.
  - All connector operations must return structured errors with retryable flags.
  - Timeouts must be enforced at the operation boundary.
  - Keep pnpm ci-check within current runtime budget.

non_negotiables:
  - gRPC is the uniform surface for connector operations and capability probing.
  - Temporal workflows in UCL are the uniform mechanism for long-running operations.
  - Auth modes must be explicit in template descriptors; no hidden connector behavior.
  - Fail-closed on auth: do not run privileged operations when scopes are missing.

refs:
  - intents/brain-search-graphrag-api-v1/*
  - docs/meta/* (endpoint contracts, capability semantics, auth expectations)
  - apps/metadata-api GraphQL schema/resolvers for endpoints/templates
  - UCL gRPC/Temporal modules (Go)

status: ready
