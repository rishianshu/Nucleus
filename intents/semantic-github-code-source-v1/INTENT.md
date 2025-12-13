title: Semantic GitHub Code Source v1
slug: semantic-github-code-source-v1
type: feature
context: >
  UCL (Go) is the unified connector layer exposing all connector capabilities via gRPC,
  with UCL-owned Temporal workflows for long-running operations. MinIO staging + sink
  is now available for Source→Staging→Sink ingestion without Temporal payload limits.
  We need a GitHub code source endpoint so Nucleus can:
  (a) discover code assets (repos/files) as catalog datasets,
  (b) preview code files reliably,
  (c) ingest code content in scalable slices into a sink (MinIO) so it can be indexed
      and used by Brain Search / GraphRAG and Workspace.

why_now: >
  Workspace value depends on code context alongside work/docs. GitHub is the fastest
  way to close the "code" lane. With MinIO staging/sink ready, we can implement a
  scalable GitHub ingestion path with robust probing/planning and produce indexable
  artifacts without relying on Temporal payload size.

scope_in:
  - Add a GitHub endpoint template (http semantic source) with explicit auth descriptors:
    - service auth (PAT / GitHub App token),
    - delegated auth descriptor (OAuth PKCE) for Workspace (descriptor only; no UI).
  - Implement UCL gRPC capabilities for GitHub:
    - endpoint.test_connection
    - metadata.plan + metadata.run (discover repos as datasets)
    - preview.plan + preview.run (file content preview with safe limits)
    - ingestion.probe + ingestion.plan + ingestion.run (adaptive slicing)
  - Implement GitHub metadata subsystem:
    - publish catalog datasets for repositories (one dataset per repo)
    - store repo metadata in normalized envelope (owner/repo, default branch, urls, updatedAt)
  - Implement scalable GitHub ingestion using Source→Staging→Sink (MinIO):
    - ingest code files + code chunks (index-ready) with strict size/binary rules
    - deterministic slice plan: per repo + path prefix + time window (when supported)
  - Hardening:
    - strict negative cases (bad token, unreachable, rate limit)
    - no false-success preview/ingestion states
    - structured errors with retryable flags

scope_out:
  - No write actions (no "post comment", no "open PR") in this slug.
  - No external LLM calls.
  - No Workspace UI changes.
  - Vector indexing job is not implemented here; we only emit index-ready chunk records
    with canonical metadata keys so the existing indexer can consume them.

acceptance:
  1. GitHub endpoint can be registered and test_connection validates auth and basic API access; auth descriptors include service + delegated modes.
  2. GitHub metadata collection publishes catalog datasets for repos and exposes repo details consistently (tenant-scoped).
  3. GitHub preview returns safe code previews (text only, size-limited) with correct failures for binaries/missing paths.
  4. GitHub ingestion uses probe+plan to produce deterministic slices and executes Source→MinIO-staging→sink with chunk outputs suitable for indexing.
  5. Hardening tests cover strict negative cases (bad token, unreachable, rate-limited) and ensure no success states leak.

constraints:
  - All connector capability decisions are via gRPC probe, not connector-family conditionals.
  - Ingestion must never pass bulk code content through Temporal payloads; use MinIO staging refs.
  - Canonical metadata keys for index-ready outputs must include tenantId + projectKey (repoKey mapped to projectKey) consistently.
  - CI must not rely on real GitHub network; use deterministic stub server or fixtures.

non_negotiables:
  - Fail-closed on auth and scope/permission errors.
  - Enforce size limits and binary detection to avoid runaway storage/indexing.
  - Deterministic slice IDs and bounded page sizes for scalability.

refs:
  - intents/minio-endpoint-and-staging-v1/*
  - intents/ucl-ingestion-pipe-and-adaptive-planning-v1/*
  - intents/ucl-grpc-capabilities-and-auth-descriptors-v1/*
  - intents/brain-search-graphrag-api-v1/*

status: ready
