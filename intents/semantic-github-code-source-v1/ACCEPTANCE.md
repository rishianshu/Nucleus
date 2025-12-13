# Acceptance Criteria

1) GitHub endpoint registration + test_connection works; auth descriptors include service + delegated modes  
   - Type: integration  
   - Evidence:
     - Seed/register template `http.github` with descriptor.auth.modes including:
       - service_pat (interactive=false)
       - delegated_auth_code_pkce (interactive=true)
     - Run test_connection against stub GitHub server:
       - valid token → success
       - invalid token → E_AUTH_INVALID, retryable=false
     - Query GraphQL templates/endpoints and assert auth descriptors are surfaced.

2) GitHub metadata collection publishes repo datasets in catalog  
   - Type: integration  
   - Evidence:
     - Run metadata.run for stub GitHub endpoint with 2 repos.
     - Assert catalog contains 2 datasets:
       - domain=catalog.dataset
       - dataset key includes tenantId + projectKey={owner}/{repo}
       - properties include defaultBranch + urls.

3) GitHub preview returns safe text previews and fails correctly for binaries/oversize  
   - Type: integration  
   - Evidence:
     - Preview a small text file → returns truncated=false and contentText non-empty.
     - Preview a binary file (stubbed) → E_PREVIEW_UNSUPPORTED, retryable=false.
     - Preview an oversize file (> maxFileBytes) → E_PREVIEW_UNSUPPORTED, retryable=false.

4) GitHub ingestion uses probe+plan slices and executes Source→MinIO-staging→sink with chunk outputs  
   - Type: integration  
   - Evidence:
     - Probe returns at least 2 repos; Plan returns deterministic slice IDs.
     - Run ingestion for one repo with multiple paths:
       - stage objects created in MinIO staging
       - sink objects created for:
         - raw.code.file
         - raw.code.file_chunk
       - ensure no activity/workflow returns bulk record arrays (stageRef-only).
     - Verify chunk records include canonical metadata keys:
       - tenantId, projectKey, sourceFamily=github, source.url

5) Hardening negative cases: bad auth/unreachable/rate limit produce correct errors and never claim success  
   - Type: integration  
   - Evidence:
     - bad token → FAILED with E_AUTH_INVALID (retryable=false)
     - unreachable stub server → FAILED with E_ENDPOINT_UNREACHABLE or E_TIMEOUT (retryable=true)
     - rate limited stub → FAILED with E_RATE_LIMITED (retryable=true)
     - In all cases, operation status must not be SUCCEEDED and no sink artifacts written.
