title: MinIO Endpoint and Staging Provider v1
slug: minio-endpoint-and-staging-v1
type: feature
context: >
  UCL (Go) is now the unified connector layer with gRPC for all endpoint capabilities
  and UCL-owned Temporal workflows for long-running operations. We are implementing
  Source→Staging→Sink ingestion to avoid Temporal payload limits. MinIO is required
  as the first concrete object-store backend to:
  (a) provide a scalable StagingProvider for ingestion runs,
  (b) act as a SinkEndpoint for raw/CDM outputs (persistent artifacts),
  (c) support future connectors like GitHub code and large doc ingestion.

why_now: >
  Several sources (Confluence, GitHub, large Jira runs) cannot reliably sink large
  results if bulk data crosses workflow boundaries. A MinIO-backed staging provider
  is the fastest way to make ingestion scalable today. It also gives us the first
  "real sink" suitable for raw payload landing and later indexing.

scope_in:
  - Implement a MinIO endpoint template + registration descriptor with strict validation.
  - Add UCL gRPC support for MinIO endpoint capabilities:
    - test_connection
    - metadata (list buckets/prefixes where applicable)
    - preview (head object / sample content)
    - staging.provider.object_store (for ingestion staging)
    - sink.write (as sink endpoint)
  - Implement ObjectStoreStagingProvider backed by MinIO:
    - write staged batches as objects,
    - return stageRef handles safe for Temporal,
    - list/get batches for sink consumption.
  - Implement MinIO SinkEndpoint:
    - persist raw/CDM record envelopes to object store paths,
    - emit destination dataset artifacts into metadata plane (catalog visibility),
    - optional auto-trigger metadata collection for the sink endpoint (if supported).
  - Hardening:
    - strict negative cases (bad creds, unreachable host, bucket missing),
    - timeouts + retryable errors,
    - never report SUCCEEDED unless objects were written.

scope_out:
  - No GitHub connector in this slug (next).
  - No Kafka staging provider (future); staging is abstracted but MinIO is the concrete impl.
  - No full "data explorer" UI for MinIO objects; only ensure catalog artifacts appear.

acceptance:
  1. MinIO endpoint template can be registered and test_connection validates access and permissions.
  2. ObjectStoreStagingProvider writes batches to MinIO and returns stageRef handles; no bulk data crosses Temporal boundaries.
  3. MinIO sink can persist raw/CDM envelopes and produces catalog-visible destination dataset artifacts.
  4. Hardening tests cover negative cases and ensure no false-success run states.

constraints:
  - gRPC surface must expose capabilities; UCL Temporal handles long-running operations.
  - Staging objects for runs should be namespaced by tenant + runId and be TTL-friendly.
  - Keep CI runtime stable; use MinIO dev container or deterministic stubs in tests.

non_negotiables:
  - Fail-closed when MinIO is required but not reachable or misconfigured.
  - All errors must be structured with retryable flags.
  - Avoid duplicating "sink/staging" semantics: staging is ephemeral; sink is persistent.

refs:
  - intents/ucl-ingestion-pipe-and-adaptive-planning-v1/*
  - intents/ucl-grpc-capabilities-and-auth-descriptors-v1/*
  - docs/meta/* (endpoint + capability + auth expectations)
  - UCL (Go) gRPC/Temporal modules

status: ready
