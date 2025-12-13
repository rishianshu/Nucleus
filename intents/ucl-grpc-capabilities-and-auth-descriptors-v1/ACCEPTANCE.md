# Acceptance Criteria

1) metadata-api uses gRPC capability probing to decide allowed actions  
   - Type: integration  
   - Evidence:
     - Add a test that stubs or uses a deterministic UCL probe response for a template/endpoint.
     - Verify metadata-api logic:
       - allows test_connection only when capability includes endpoint.test_connection,
       - allows metadata run only when capability includes metadata.run,
       - blocks preview when preview.run is absent.
     - Evidence path example:
       - `apps/metadata-api/src/endpoints/capabilityProbe.test.ts`

2) Endpoint templates expose auth descriptors through GraphQL  
   - Type: unit|integration  
   - Evidence:
     - Seed at least one template with `descriptor.auth.modes` including an interactive delegated mode.
     - Query GraphQL templates and assert:
       - `descriptor.auth.modes` present,
       - includes `interactive=true` for delegated modes,
       - includes `profileBinding.supported=true` when appropriate.
     - Evidence path example:
       - `apps/metadata-api/src/graphql/templatesAuthDescriptor.test.ts`

3) Long-running operations expose consistent state via gRPC and map to run states  
   - Type: integration  
   - Evidence:
     - Start a METADATA_RUN (or PREVIEW_RUN) via StartOperation.
     - Poll GetOperation until terminal state in test (use fake/time-bounded worker).
     - Verify:
       - status transitions QUEUED→RUNNING→SUCCEEDED (or FAILED),
       - metadata-api run table mirrors status deterministically (no false SUCCEEDED).
     - Evidence path example:
       - `apps/metadata-api/src/ops/operationsMapping.test.ts`

4) Hardening: strict negative cases produce correct errors and never show success  
   - Type: integration|e2e  
   - Evidence:
     - Bad credentials:
       - test_connection returns E_AUTH_INVALID, retryable=false.
     - Unreachable endpoint:
       - returns E_ENDPOINT_UNREACHABLE or E_TIMEOUT, retryable=true.
     - Missing scopes:
       - returns E_SCOPE_MISSING with requiredScopes, retryable=false.
     - For each case, verify run state is FAILED (not SUCCEEDED) and error payload is surfaced.
     - Evidence path example:
       - `apps/metadata-api/src/endpoints/hardeningNegativeCases.test.ts`
       - Optional Playwright grep: "endpoint hardening negative cases"
