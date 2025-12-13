# Acceptance Criteria

1) MinIO endpoint template supports registration and test_connection validates access  
   - Type: integration  
   - Evidence:
     - Seed/register a MinIO endpoint using the `object.minio` template.
     - Run test_connection:
       - with valid creds: succeeds and returns capability list includes staging.provider.object_store + sink.write
       - with invalid creds: fails with E_AUTH_INVALID, retryable=false
     - Suggested tests:
       - `ucl/tests/minio_test_connection_test.go`
       - plus metadata-api GraphQL registration smoke if applicable.

2) ObjectStoreStagingProvider writes batches and returns stageRef handles; no bulk payload in workflow  
   - Type: integration  
   - Evidence:
     - Run a stub ingestion slice producing >= 10,000 envelopes.
     - Source writes to MinIO staging and returns stageRef + batchRefs only.
     - Assert:
       - stage objects exist under `staging/{tenantId}/{runId}/...`
       - workflow/activity returns do not include record arrays.
     - Suggested tests:
       - `ucl/tests/minio_staging_provider_test.go`

3) MinIO SinkEndpoint persists raw/CDM envelopes and produces catalog-visible artifacts  
   - Type: integration  
   - Evidence:
     - Given a stageRef with at least two batches and mixed entityKinds,
       run sink consumption and write destination objects.
     - Assert:
       - destination objects exist under `sink/{tenantId}/{sinkEndpointId}/...`
       - recordCount and bytesWritten stats are reported
       - metadata plane has dataset artifacts created/updated with minio:// urls
         (via GraphQL query or direct DB check, depending on existing harness).
     - Suggested tests:
       - `ucl/tests/minio_sink_write_and_catalog_artifacts_test.go`

4) Hardening negative cases return structured errors and never claim SUCCEEDED  
   - Type: integration  
   - Evidence:
     - Unreachable endpointUrl → E_ENDPOINT_UNREACHABLE or E_TIMEOUT, retryable=true
     - Bucket missing when required → E_BUCKET_NOT_FOUND, retryable=false
     - Permission denied → E_PERMISSION_DENIED, retryable=false
     - For each:
       - operation ends FAILED
       - error payload present and structured
       - no destination objects written
     - Suggested tests:
       - `ucl/tests/minio_negative_cases_test.go`
