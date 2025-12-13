# SPEC — UCL Ingestion Pipe and Adaptive Planning v1

## Problem

Ingestion must scale across sources like Jira and Confluence. Today, large runs can
break because:
- Temporal payloads or activity boundaries accidentally carry large record arrays.
- Non-JDBC sources lack robust probing/planning that slices ingestion into bounded
  batches (e.g., per Confluence space, per Jira project/time range).

We need a consistent ingestion data plane:

Source → StagingProvider (pipe/queue) → Sink

Where:
- Temporal orchestrates execution and progress, but never transports bulk records.
- Endpoint hooks provide probe/plan so large ingestion can be sliced predictably.

## Interfaces / Contracts

### A) StagingProvider abstraction

Create a UCL-side interface:

- `PutBatch(stageId, sliceId, batchSeq, records[]) -> { stageRef, batchRef, stats }`
- `ListBatches(stageRef, sliceId) -> [batchRef...]`
- `GetBatch(stageRef, batchRef) -> records[]`
- `FinalizeStage(stageRef) -> ok`

Constraints:
- stageRef is a small opaque string safe to pass through Temporal.
- records are only ever stored/retrieved via staging provider.

Providers:
1) **ObjectStoreStagingProvider (MinIO)**
   - Store batches as objects under a deterministic prefix:
     `staging/{tenantId}/{runId}/{sliceId}/{batchSeq}.jsonl.gz` (example).
2) **MemoryStagingProvider**
   - For dev/tests or small data only.
   - Enforce max bytes; when exceeded, return E_STAGE_TOO_LARGE (retryable=false).

Selection policy:
- If estimatedBytes > SMALL_THRESHOLD (e.g. 2–5MB), require object-store staging.
- If object-store config missing and large run detected → fail with E_STAGING_UNAVAILABLE.

### B) Record envelope (raw vs CDM)

Staging batches must store records in a consistent envelope:

- `recordKind`: "raw" | "cdm"
- `entityKind`: e.g., "work.item" | "doc.item"
- `source`: { endpointId, sourceFamily, sourceId, url?, externalId? }
- `tenantId`, `projectKey` (normalized)
- `payload`: JSON (raw or CDM row shape)
- `observedAt`: timestamp

Notes:
- This enables future lineage-lite without implementing full lineage.
- CDM mapping can be applied before staging (preferred) or at sink read time,
  but the pipeline must treat it as just another recordKind.

### C) Prober + Planner endpoint hooks

Define UCL endpoint hooks:

- `ProbeIngestion(input) -> ProbeResult`
  - returns: estimatedCounts, estimatedBytes, sliceKeys (optional), cursorHints
- `PlanIngestion(input, probeResult) -> SlicePlan`
  - returns: list of `slice` objects:
    - sliceId
    - query constraints (spaceKey, projectKey, time window, page range, etc.)
    - expected size bounds

Source-specific expectations:
- **Confluence**
  - Probe: list spaces (or configured subset), estimate pages per space if possible.
  - Plan: slices per space (and optionally per page range) with bounded page limits.
- **Jira**
  - Probe: list projects or configured projects; estimate issues count in range (best-effort).
  - Plan: slices per project (and optionally time windows) with bounded page limits.

### D) UCL Ingestion workflow

UCL-owned Temporal workflow (ingestion run):

1) Validate endpoint capabilities:
   - ingestion.plan + ingestion.run must be supported.
2) Probe:
   - call endpoint ProbeIngestion with filters.
3) Plan:
   - call endpoint PlanIngestion using ProbeResult.
4) Execute slices:
   - For each slice (can be sequential v1; parallel in future):
     - Source activity reads from source API in pages, writing each page/batch to StagingProvider.
     - Sink activity reads batches from stageRef and persists to sink endpoint.
5) Commit:
   - Mark operation SUCCEEDED only after sink confirms persisted counts.
6) State:
   - OperationState includes slicesTotal, slicesDone, recordsWritten, bytesStaged, errors.

### E) Operation reporting

Reuse the existing gRPC StartOperation/GetOperation from UCL.
- `StartOperation(kind=INGESTION_RUN, endpointId, sinkId, config...) -> operationId`
- `GetOperation(operationId) -> OperationState`
OperationState must include:
- status: QUEUED/RUNNING/SUCCEEDED/FAILED
- retryable + structured error codes
- progress counters: slicesDone/Total, recordsWritten, bytesStaged

### F) Error model (hardening)

New/required errors:
- `E_STAGING_UNAVAILABLE` (retryable=true if config can change)
- `E_STAGE_TOO_LARGE` (retryable=false; indicates misconfiguration or forced provider)
- `E_SOURCE_PAGE_FAILED` (retryable=true)
- `E_SINK_WRITE_FAILED` (retryable=true/false depending)
- existing auth/unreachable errors from UCL contract remain applicable

## Data & State

- Staging objects are ephemeral but must be retained at least for run duration.
- Optionally retain for debugging with TTL (out of scope; can be config only).

Idempotency:
- Slice execution should accept an idempotency key:
  (operationId, sliceId, batchSeq) so retries do not duplicate sink writes if sink supports idempotency.

## Constraints

- No bulk record arrays in Temporal workflow inputs/outputs beyond staging refs.
- Deterministic plan output for a given probe + filters.
- Dev/test harness must validate large-run behavior without needing real Confluence/Jira.

## Acceptance Mapping

- AC1 → tests verify stageRef-only flow and no bulk record passing.
- AC2 → probe/plan tests for Jira + Confluence with deterministic plans.
- AC3 → end-to-end slice execution using stub endpoints + stub sink.
- AC4 → negative/hardening tests for staging unavailable, bad auth, unreachable.

## Risks / Open Questions

- R1: Estimating bytes/counts for APIs without count endpoints.
  - Accept best-effort; use page sampling or conservative defaults.
- R2: Idempotent sink writes.
  - v1 can accept "at-least-once" but must document counters and retryability.
