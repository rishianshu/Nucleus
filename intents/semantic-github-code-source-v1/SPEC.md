# SPEC — Semantic GitHub Code Source v1

## Problem

We need GitHub code as a first-class semantic source so Workspace and Brain can
retrieve and cluster code alongside work/docs. This requires:
- endpoint abstraction via UCL gRPC capabilities,
- robust auth descriptors (service + delegated),
- metadata-driven datasets (repos in catalog),
- scalable ingestion without Temporal payload constraints,
- index-ready outputs (file chunks with canonical metadata keys).

## Interfaces / Contracts

### 1) Endpoint template descriptor

TemplateId: `http.github`

Descriptor (JSON) must include:

- connection:
  - baseUrl (default `https://api.github.com`)
  - apiMode: `rest` (v1)
- auth:
  - modes:
    - `service_pat` (interactive=false)
      - requiredFields: token
      - scopes hints: repo read
    - `delegated_auth_code_pkce` (interactive=true, descriptor-only in this slug)
      - scopes hints: read-only
  - profileBinding:
    - supported: true
    - principalKinds: ["user"]
- metadata knobs:
  - owner (org/user) allowlist
  - repo allowlist (optional)
- ingestion knobs:
  - branch (default branch if omitted)
  - pathPrefixes (optional)
  - fileExtensionsInclude (optional)
  - maxFileBytes (default e.g. 1_000_000)
  - chunking:
    - chunkBytes (default e.g. 8_000)
    - overlapBytes (default e.g. 400)

Canonical key mapping:
- `projectKey` is normalized to the GitHub repo key:
  - `projectKey = "{owner}/{repo}"` (repoKey mapped into projectKey)

### 2) Capability set (gRPC)

GitHub endpoint advertises:
- endpoint.test_connection
- metadata.plan, metadata.run
- preview.plan, preview.run
- ingestion.probe, ingestion.plan, ingestion.run
- auth.service
- auth.delegated.auth_code_pkce (descriptor only)

### 3) Metadata collection outputs (catalog datasets)

Metadata.run must publish datasets representing repos.

Dataset identity (catalog):
- domain: `catalog.dataset`
- logical key: `catalog.dataset:code.repo:{tenantId}:{projectKey}`
- properties include:
  - repoFullName (owner/repo)
  - defaultBranch
  - htmlUrl
  - apiUrl
  - visibility
  - updatedAt
  - labels: ["code", "github"]

This enables ingestion gating: ingestion units must reference catalog datasets.

### 4) Preview contract

Preview.run supports:
- file content preview:
  - input: repo (projectKey), ref (branch/sha), path
  - output:
    - contentText (truncated)
    - detectedLanguage (best-effort by extension)
    - truncated: boolean
    - url (github web url if available)

Safety rules:
- If binary detected or file > maxFileBytes:
  - return error E_PREVIEW_UNSUPPORTED (retryable=false) with details
- If missing path:
  - E_NOT_FOUND (retryable=false)

### 5) Ingestion probing + planning

ProbeIngestion(input) returns:
- repos to ingest (based on filters)
- estimated file counts per repo (best-effort)
- optional directory hints for slicing

PlanIngestion(input, probe) returns slices:
- sliceId deterministic:
  - `github:{projectKey}:{branch}:{pathPrefix}:{timeWindowStart?}:{timeWindowEnd?}`
- slices per repo and pathPrefix (default pathPrefix="") with bounded page limits

If repo is "large" (heuristic from probe), planner should split into multiple pathPrefix slices
(e.g., top-level dirs) using the recursive tree listing (stubbed in tests).

### 6) Ingestion execution (Source→Staging→Sink)

For each slice:
- Source reads file listing (tree) and then file contents (bounded):
  - skip binaries
  - skip > maxFileBytes
- Source emits two record types into staging:
  1) `raw.code.file`
     - payload: { repo, path, sha, size, url, language?, contentText? (optional) }
     - include source.url + source.externalId (sha/path)
  2) `raw.code.file_chunk`
     - payload: { repo, path, sha, chunkIndex, text }
     - chunkBytes/overlapBytes must be used

Both must include canonical metadata:
- tenantId
- projectKey (repo key)
- source { sourceFamily="github", endpointId, url, externalId }

Sink (MinIO sink endpoint) persists:
- datasetSlug = raw.code.file / raw.code.file_chunk
- destination objects under sink layout

### 7) Error model (hardening)

Required errors:
- E_AUTH_INVALID (retryable=false)
- E_SCOPE_MISSING / E_PERMISSION_DENIED (retryable=false)
- E_ENDPOINT_UNREACHABLE / E_TIMEOUT (retryable=true)
- E_RATE_LIMITED (retryable=true; include resetAt if available)
- E_INVALID_CONFIG (retryable=false)
- E_PREVIEW_UNSUPPORTED (retryable=false)

### 8) Tests must be deterministic

CI must not hit real GitHub.
Use:
- stub GitHub API server in tests that serves:
  - list repos
  - list tree (recursive)
  - get file content
  - rate limit behavior

## Data & State

- No new DB schemas required beyond template descriptor storage.
- All ingestion bulk data travels via MinIO staging and MinIO sink artifacts.

## Constraints

- Never pass bulk file content through Temporal payloads.
- Bound file size and chunk output size.
- Deterministic slice IDs and plans.

## Acceptance Mapping

- AC1 → template descriptor + test_connection tests + GraphQL exposure
- AC2 → metadata.run produces catalog datasets for repos
- AC3 → preview safety rules tests
- AC4 → probe/plan + staging/sink ingestion tests producing file_chunk artifacts
- AC5 → negative hardening tests
