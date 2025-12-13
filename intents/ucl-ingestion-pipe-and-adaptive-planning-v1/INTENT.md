title: UCL Ingestion Pipe and Adaptive Planning v1
slug: ucl-ingestion-pipe-and-adaptive-planning-v1
type: feature
context: >
  UCL (Go) is now the unified connector runtime with gRPC capabilities and UCL-owned
  Temporal workflows for long-running operations. Current ingestion paths still
  risk Temporal payload limits by passing large record batches through workflow
  boundaries, and non-JDBC semantic sources (Jira/Confluence) do not yet have
  strong probing/planning (slicing) like the earlier JDBC/Spark design did.

why_now: >
  Workspace will not feel real until ingestion scales reliably. We must eliminate
  Temporal message-size coupling to data volume and introduce endpoint-specific
  prober/planner hooks so sources like Confluence and Jira can be ingested in
  predictable slices (space/project/time) with stable progress and parallelism.

scope_in:
  - Introduce a staging/pipe abstraction between Source and Sink:
    - Source writes records to a StagingProvider and returns a small stageRef,
      never returning bulk records through Temporal.
    - Sink reads from stageRef in batches and persists to the configured sink.
  - Implement default staging providers:
    - object-store based (MinIO) for large runs (required for big payloads),
    - memory staging for small runs (bounded, dev-friendly).
  - Add endpoint hooks for ingestion probing + planning:
    - Prober estimates volume and enumerates slice keys (e.g., Confluence spaces,
      Jira projects/statuses) where applicable.
    - Planner converts probe results + ingestion config filters into a slice plan.
  - Update UCL ingestion workflow to:
    - run probe → plan → execute slices,
    - for each slice: Source→Stage→Sink,
    - persist operation state/progress via the existing gRPC operation model.
  - Hardening:
    - strict timeouts, retryable errors, no false "success" ingestion states,
    - deterministic, testable behavior using stub connectors.

scope_out:
  - No new connectors added here (Git/Slack/etc. out of scope).
  - No new Workspace UI; only backend contracts and tests.
  - No Kafka requirement; staging is abstracted and can later be backed by Kafka.
  - No deep lineage work beyond keeping source identifiers/urls in record envelopes.

acceptance:
  1. Large ingestion runs do not pass bulk records through Temporal payloads; data
     flows through StagingProvider using stageRef handles.
  2. Confluence and Jira implement ingestion probing + slice planning producing
     deterministic slice plans from filters (space/project/time).
  3. Ingestion workflow executes multi-slice runs end-to-end (Source→Stage→Sink)
     and reports progress via operation state consistently.
  4. Hardening tests cover message-size safety, retryability, and strict negative
     cases (staging unavailable, bad auth, unreachable source) with correct errors.

constraints:
  - gRPC remains the uniform control surface; long-running work remains in UCL Temporal.
  - StagingProvider must be pluggable (object store today, Kafka later).
  - Preserve existing ingestion config concepts (raw vs CDM mode) without changing UI flows.
  - Keep CI runtime within current budgets.

non_negotiables:
  - Fail-closed when staging for large runs is unavailable (no silent truncation).
  - Operation state must not claim SUCCEEDED unless sink confirms persisted records.
  - Probe/plan must be source-aware but exposed via a consistent endpoint hook interface.

refs:
  - intents/ucl-grpc-capabilities-and-auth-descriptors-v1/*
  - intents/ingestion-filters-and-incremental-jira-v1/*
  - intents/semantic-confluence-source-v1/*
  - docs/meta/* (ingestion + endpoint contracts)
  - UCL (Go): gRPC operation contracts + Temporal workflow modules

status: ready
