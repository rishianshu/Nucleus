# SPEC — Ingestion strategy unification v1

## Problem

The ingestion plane currently has:

- A Source → Staging → Sink design on paper, but some implementations still pass `NormalizedRecord[]` across Temporal instead of using staging providers.   
- Mature adaptive planning/probing for JDBC (slices, counts, type handling) but less mature strategies for Jira and Confluence, which should slice by project/space, time windows, and pagination.   
- A metadata-first contract (units map to catalog datasets) that’s not strictly enforced everywhere.   
- `metadata_worker.py` that still knows about Jira/Confluence CDM shapes directly, instead of delegating to a shared CDM mapper registry.  [oai_citation:1‡cdm-mapper-refactor.md](sediment://file_000000001c78720686491609302121b0)  

This leads to:

- Fragile behavior for large ingestions (e.g., tens of thousands of Confluence pages),
- Extra work to bring new endpoints online,
- Drift between specs and actual behavior.

We need a single ingestion strategy contract that all sources obey, and we need to enforce the Source → Staging → Sink and CDM registry patterns in code.

## Interfaces / Contracts

### 1. Adaptive planning interface (Python, per endpoint family)

Each **SourceEndpoint family** (e.g., `jdbc.postgres`, `http.jira`, `http.confluence`) must implement:

1. **Unit enumeration** (already in endpoint HLD):

   ```python
   class SupportsIngestionUnits(Protocol):
       def list_units(self, context: IngestionContext) -> list[EndpointUnitDescriptor]:
           ...

	•	EndpointUnitDescriptor maps directly to catalog datasets (dataset id/key, domain, description, policies).

	2.	Incremental planning:

@dataclass
class IngestionSlice:
    key: str             # slice identifier, unique within (endpoint, unit, run)
    sequence: int        # ordering
    params: dict         # opaque slice parameters (e.g., time window, offset/limit)

@dataclass
class IngestionPlan:
    endpoint_id: str
    unit_id: str
    slices: list[IngestionSlice]
    statistics: dict     # optional estimates (total_rows, total_bytes, etc.)
    strategy: str        # e.g., "jdbc-range", "jira-project-window", "confluence-space-window"

Strategy entrypoint:

class SupportsIncrementalPlanning(Protocol):
    def plan_incremental_slices(
        self,
        unit: EndpointUnitDescriptor,
        checkpoint: dict | None,
        policy: dict,
        target_slice_size: int,
    ) -> IngestionPlan:
        ...

Requirements:
	•	JDBC: slice by range predicates on incremental columns (WHERE incr > lower AND incr <= upper), using probing (COUNT/min/max) as needed.  ￼
	•	Jira: slice by project and updated_at windows with JQL pagination.
	•	Confluence: slice by space and updated_at windows, capped to a bounded number of pages per slice (e.g., 100–500 per slice).
Planners must use endpoint-specific probing metadata and respect endpoint rate-limit guidance where available.

2. Source → Staging → Sink (no large payloads across Temporal)

The data-plane contract from INGESTION-SOURCE-STAGING-SINK-v1 is authoritative:
	•	SourceEndpoint: reads from upstream and exports rows.
	•	StagingProvider: buffers rows between Source and Sink (in-memory, HDFS, object store, or queue).
	•	SinkEndpoint: consumes from staging and persists rows to the configured sink (warehouse, CDM tables, etc.).

We must enforce:
	1.	Python worker behavior (runIngestionUnit activity):
	•	For each IngestionSlice, the worker:
	•	Builds the SourceEndpoint and SinkEndpoint.
	•	Allocates a StagingSession via the configured StagingProvider.
	•	Streams rows from SourceEndpoint into staging_session.writer().write_batch(...).
	•	Completes the session and returns:
	•	slice_key,
	•	new_checkpoint (for KV),
	•	stats (rows, bytes, timings),
	•	a staging handle (opaque, serializable descriptor for the session, e.g. { providerId, sessionId }), not the rows.
	•	No array of NormalizedRecord or raw rows is allowed in the Temporal activity payload.
	2.	Sink consumption:
	•	The same or a follow-on activity rebuilds a StagingSession from the handle, uses reader().iter_batches(...), and writes to SinkEndpoint.
	•	After sink completes, staging session is closed/cleaned up.

Temporal workflows only see handles + stats, not bulk data.

3. Temporal workflow and GraphQL flow

GraphQL layer (startIngestion, etc.):
	•	Validates that:
	•	Endpoint exists and is enabled.
	•	Dataset exists in catalog for that endpoint and is flagged as ingestion-enabled.
	•	Resolves:
	•	unitId (ties ingestion to catalog dataset),
	•	sink config (including CDM mode and sink endpoint),
	•	staging provider selection (default or configured).

On success, it enqueues ingestionRunWorkflow with:

{
  endpointId,
  unitId,
  sinkId,
  stagingProviderId,
  policy,          // includes mode = "raw" | "cdm", filters, etc.
}

Workflow (ingestionRunWorkflow):
	1.	startIngestionRun:
	•	Load KV checkpoint for (endpointId, unitId, sinkId).
	•	Mark Prisma IngestionUnitState as RUNNING.
	2.	pythonActivities.runIngestionUnit:
	•	Call into Python planner/worker which:
	•	Uses list_units and plan_incremental_slices.
	•	Executes Source → Staging → Sink per slice.
	•	Returns:
	•	newCheckpoint,
	•	stats summary,
	•	per-slice stats as needed.
	3.	completeIngestionRun / failIngestionRun:
	•	Persist newCheckpoint to KV.
	•	Update IngestionUnitState and run record with stats and strategy name.
	•	Surface status back to the UI.

There must be no source-specific branches in the workflow; it operates entirely in terms of endpoint id, unit id, policy, and checkpoint.

4. CDM mapper registry integration

Per cdm-mapper-refactor.md, CDM mapping must be done via a registry keyed by endpoint+unit, not by if jira/if confluence in metadata_worker.py.  ￼
	•	Introduce or wire the existing registry module, e.g. metadata_service.cdm.registry, with APIs:

register_cdm_mapper(endpoint: str, unit_id: str, mapper: Callable)
apply_cdm(endpoint: str, unit_id: str, records: list[dict], default_model: str | None) -> list[dict]


	•	Jira and Confluence runtimes register their mappers at import time.
	•	When ingestion policy mode == "cdm":
	•	Source or sink code calls apply_cdm(...) on normalized records read from staging.
	•	The worker stays vendor-agnostic: no Jira/Confluence-specific CDM logic in metadata_worker.py.

CDM remains sink-agnostic: mappers output CDM rows; SinkEndpoints decide where/how to persist.

5. KV state model

KV store remains the canonical store for incremental state and run stats.  ￼
	•	Keys follow the existing pattern:
ingest::<vendor>::endpoint::<endpointId>::unit::<unitId>::sink::<sinkId?>
	•	Each planner defines the shape of its checkpoint:
	•	JDBC: last incremental column value per dataset.
	•	Jira: watermarks per project/filter (e.g. lastUpdatedAt).
	•	Confluence: per space/time window watermarks.

The workflow passes checkpoint into planners and persists the returned newCheckpoint after successful runs.

Constraints
	•	GraphQL schema changes must be additive.
	•	Ingestion runs must be idempotent and resumable:
	•	Re-running a slice should not duplicate data in sinks.
	•	No KB as primary sink:
	•	KB receives only semantic summaries/signals (optional), not bulk rows.

Acceptance Mapping
	•	AC1 → Unified adaptive planning interface implemented for JDBC, Jira, Confluence.
	•	AC2 → Temporal workflow uses Source → Staging → Sink for all units, without bulk record payloads.
	•	AC3 → Metadata-first invariant enforced at GraphQL layer with typed errors and tests.
	•	AC4 → CDM mapping via registry, no endpoint-specific CDM logic in metadata_worker.py.
	•	AC5 → KV incremental state read/write consistent across planners.
	•	AC6 → pnpm ci-check passes with ingestion tests updated.

Risks / Open Questions
	•	R1: Wrapping legacy JDBC planners may require compatibility shims before deeper refactors.
	•	R2: Staging provider choice (in-memory vs. HDFS vs. queue) may need tuning; v1 can use existing local/Spark staging with the handle pattern.
	•	Q1: Multi-unit/endpoint-wide runs are still per-unit; later slugs can introduce multi-unit orchestration if needed.
