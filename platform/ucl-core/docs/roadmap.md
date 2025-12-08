# UCL Development Roadmap: Phased Approach

## Executive Summary
This document outlines a **3-phase approach** to developing the Universal Connectivity Layer (UCL), ensuring we:
1. **Capture** everything from the legacy system
2. **Improve** architecture decisions and kill legacy patterns
3. **Extend** with new Action capabilities

---

## Phase 1: Complete Spec Coverage (Current)
**Goal**: Document and proto-define ALL existing capabilities from `spark-ingestion`.

### 1.1 Completed Proto Files
| File | Coverage |
| :--- | :--- |
| `gateway.proto` | Discovery, Schema, Read, Write, Actions |
| `connector.proto` | Full Source/Sink interface, Planning, Statistics |
| `orchestration.proto` | Strategies (Full/SCD1), Drift, Guardrails |
| `cdm.proto` | CDM Registry, Work/Docs domain models |
| `metadata.proto` | Collection, Caching, Pipeline contracts |

### 1.2 Remaining Items (Tier 2 & 3)
- [x] Planner Registry -> Exposed via `orchestration.proto::ListStrategies`
- [x] Normalizer Contract -> Implicit in `GetSchema` (connector responsibility)
- [x] Endpoint Review -> Connector interface is generic; implementations separate
- [x] CDM Proto Definitions -> Defined in `cdm.proto`

### 1.3 Spec Status: **COMPLETE**
All legacy interfaces have been mapped to UCL Protos.

---

## Phase 2: Architecture Improvements & Legacy Cleanup
**Goal**: Identify what to **kill**, **alter**, or **improve** for a production-grade system.

### 2.1 What to KILL (Legacy Patterns)

| Pattern | Problem | UCL Solution |
| :--- | :--- | :--- |
| `sys.path` manipulation | Fragile imports, non-standard | Go modules / proper packaging |
| Spark dependency | Heavy runtime for simple metadata | Lightweight gRPC workers |
| `Dict[str, Any]` everywhere | No type safety | Typed Protos |
| `MetadataRepository` in-memory | No persistence abstraction | gRPC Metadata Service |
| Python-only connectors | GIL, performance limits | Go core + Python plugins |

### 2.2 What to ALTER (Improve)

| Area | Current | Improved |
| :--- | :--- | :--- |
| **Ingestion Slicing** | Python logic in AdaptivePlanner | Connector-level `PlanSlices` RPC (parallelizable) |
| **Schema Drift** | Python class, Spark-coupled | gRPC Normalizer middleware (streaming) |
| **CDM Mapping** | Python functions | gRPC CDM Service (cacheable, versioned) |
| **Metadata Caching** | File-based JSON | Distributed cache (Redis/etcd) via gRPC |

### 2.3 Architecture Decision Records (ADRs)

#### ADR-001: Scalability for Large Ingestion
**Context**: Current system reads all data into Spark before writing.

**Decision**: UCL uses **streaming gRPC** with backpressure.
- `Read()` returns `stream ReadResponse` (record-by-record).
- Worker buffers and batches to Sink.
- For massive datasets (>1GB), connector returns S3 pointers instead of streaming.

**Consequences**: Lower memory footprint, horizontal scaling.

---

#### ADR-002: Metadata Probing vs Full Schema Fetch
**Context**: Current system fetches full schema even for "is this table empty?" checks.

**Decision**: UCL separates `GetStatistics` (lightweight) from `GetSchema` (heavy).
- Probing calls `GetStatistics(metrics=["row_count"])` -> O(1).
- UI/Catalog calls `GetSchema()` with full field details.

**Consequences**: Faster incremental planning, reduced source load.

---

#### ADR-003: Strategy as Orchestration, Not Connector Logic
**Context**: Current `FullRefreshStrategy` and `Scd1Strategy` mix orchestration with Spark logic.

**Decision**: UCL separates:
- **Connector**: Provides `Read`, `Write`, `PlanSlices` (stateless).
- **Orchestration Service**: Implements strategy logic (Temporal workflows).

**Consequences**: Connectors simpler; strategies reusable across connectors.

---

#### ADR-004: CDM as a Service, Not Embedded Logic
**Context**: Current CDM mapping is embedded in `jira_work_mapper.py`.

**Decision**: UCL CDM Service:
1. Receives raw records.
2. Looks up mapper by `(family, unit_id, cdm_model_id)`.
3. Returns typed `CdmRecord` with `cdm_id`.

**Consequences**: CDM mappings versionable, testable, cacheable.

---

### 2.4 Scalability Design Considerations

| Scenario | Legacy Approach | UCL Approach |
| :--- | :--- | :--- |
| **10M row ingestion** | Single Spark job, memory-bound | Sliced into N workers, stream-to-sink |
| **100 concurrent probes** | Sequential, slow | Stateless Gateway, horizontal scale |
| **Schema drift on 500 columns** | Full compare in Python | Streaming validation, early abort |
| **Multi-tenant metadata** | Single cache file | Partitioned by tenant, TTL per-target |

---

## Phase 3: New Action Capabilities
**Goal**: Extend UCL beyond ingestion to support **write-back actions**.

### 3.1 Action Categories

| Category | Examples |
| :--- | :--- |
| **CRUD Actions** | `jira.create_issue`, `confluence.update_page` |
| **Trigger Actions** | `jenkins.start_build`, `airflow.trigger_dag` |
| **Query Actions** | `jira.search_issues`, `postgres.run_adhoc_query` |
| **Admin Actions** | `jira.add_user_to_project`, `postgres.create_schema` |

### 3.2 Action Proto Design (Already in `gateway.proto`)
```protobuf
rpc ExecuteAction(ExecuteActionRequest) returns (ExecuteActionResponse);
```
- `endpoint_id`: Which connection to use.
- `action_name`: The operation (defined by connector).
- `mode`: SYNC (immediate) or ASYNC (Temporal).

### 3.3 Connector Action Interface (Already in `connector.proto`)
```protobuf
rpc Execute(ExecuteRequest) returns (ExecuteResponse);
```
- Each connector defines its supported actions via `GetCapabilities`.
- Actions are schema-validated (input via JSON Schema).

### 3.4 Phase 3 Milestones
1. [ ] Define Jira actions: `create_issue`, `transition_issue`, `add_comment`
2. [ ] Define Confluence actions: `create_page`, `update_page`
3. [ ] Implement Async Action Workflow (Temporal)
4. [ ] Build Action UI in Console

---

## Implementation Order

### Sprint 1-2: Foundation
- [ ] Finalize all Proto files (review complete)
- [ ] Setup `buf` generation for Go stubs
- [ ] Implement Gateway skeleton (gRPC server)
- [ ] Implement basic JDBC Connector (Read + Schema)

### Sprint 3-4: Data Plane
- [ ] Implement Orchestration Service (Full strategy)
- [ ] Implement Temporal Worker integration
- [ ] Migrate Jira Connector

### Sprint 5-6: Intelligence
- [ ] Implement CDM Service
- [ ] Implement Metadata Service (Caching, Collection)
- [ ] Implement Normalizer middleware

### Sprint 7-8: Actions
- [ ] Implement Execute flow
- [ ] Add Jira action handlers
- [ ] UI integration

---

## Summary
The UCL is designed to be:
1. **A superset** of all legacy capabilities (Phase 1 ✅)
2. **Architecturally superior** with streaming, microservices (Phase 2)
3. **Extensible** with Action capabilities (Phase 3)
