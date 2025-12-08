# Universal Connectivity Layer (UCL) Architecture Specification (V3)

## 1. System Overview
The **Universal Connectivity Layer (UCL)** is a modular, high-intelligence connectivity mesh. It is not just a pipe; it is an orchestrated system that understands **Data Semantics**.

It preserves the modularity of the legacy `spark-ingestion` framework while standardizing the interface via gRPC.

### 1.1 The Intelligence Layer (New)
To support "Adaptive Planning" and "Semantic Sources", UCL introduces explicit middleware components in the Worker:

1.  **Probe**: Queries the source for statistics (Row counts, Max Watermarks) *before* reading.
2.  **Planner**: Uses Probe stats to generate `IngestionSlices`.
3.  **Reader**: Executes a `Slice` (generic object) -> Connector translates to specific query (JQL/SQL).
4.  **Normalizer**: Applies schema enforcement and type coercion on the stream.
5.  **CDM Mapper**: Transforms source-specific dicts into Canonical Data Models (e.g. `JiraIssue` -> `TicketCDM`).

---

## 2. High-Level Architecture (The Data Flow)

```mermaid
graph TD
    Client[Ingestion Service] -->|PlanIngestion| Gateway
    Gateway -->|Job| Temporal[Temporal Workflow]

    subgraph "UCL Worker / Intelligence Engine"
        Temporal -->|Phase 1: Knowledge| Probe[Probing Engine]
        Probe -->|GetStatistics| Connector
        
        Temporal -->|Phase 2: Strategy| Planner[Adaptive Planner]
        Planner -->|PlanSlices| Connector
        
        Temporal -->|Phase 3: Execution| Reader[Slice Reader]
        Reader -->|Read(Slice)| Connector
        
        Reader -->|Raw Stream| Normalizer[Schema Guardrails]
        Normalizer -->|Typed Stream| Mapper[CDM Mapper]
    end

    subgraph "External"
        Connector --> SaaS
    end
```

## 3. Subsystem Deep Dive

### 3.1 Metadata Driven Ingestion
The **Planner** is the brain. It doesn't just say "Read All". 
- **Adaptive Planning**: If `Probe` says "System has 10M rows", Planner asks Connector for "100 slices of 100k".
- **Schema Drift**: The `Normalizer` fetches the *expected* schema (from Metadata Service/Registry) and compares it with the *actual* record stream. If they differ => `DriftAlert`.

### 3.2 Semantic Source & CDM
UCL Connectors are "Semantic Aware".
- A `JiraConnector` doesn't just return JSON. It knows it returns `Issues`.
- **Mapper Config**: Each dataset (`jira_issues`) is associated with a **CDM Mapper** (defined in CUE/Protobuf).
- **Execution**: The stream passes through the Mapper *inside the UCL Worker* before being sinked. This abstracts the source format from the consumer.

### 3.3 Generic Slicing (No more raw JQL)
As requested, the Ingestion API talks in `Slices`, not `JQL`.

**Legacy**:
`run_ingestion_unit(query="project = 'ABC' AND updated > '2023'...")`

**UCL**:
`Read(slice={ "lower_bound": "2023-01-01", "partition_key": "project", "partition_value": "ABC" })`

The **Connector** is responsible for translating this generic `Slice` object into:
- Jira: `project = 'ABC' AND updated >= '2023-01-01'`
- SQL: `WHERE project_id = 'ABC' AND updated_at >= '2023-01-01'`

This keeps the orchestration layer **clean** and **agnostic**.

## 4. Capability Preservation
| Legacy Component | UCL Component | Improvement |
| :--- | :--- | :--- |
| `IngestionPlan` | `PlanSlices` RPC | Strongly typed, language agnostic |
| `IngestionSlice` | `IngestionSlice` Proto | Portable across network |
| `QueryPlanModel` | `ReadRequest` Filters | Standardized Query AST |
| `SchemaValidator` | `Normalizer` Middleware | Streaming validation, Drift Detection |
| `CDM Models` | `CDM Mapper` Middleware | Decoupled from Python Code |

## 5. Summary
UCL is **Action Capable** (Control Plane) AND **Intelligence Capable** (Data Plane). 
It encapsulates the complexity of "How to query Jira incrementally" inside the `PlanSlices` and `Read` implementations of the Connector, exposing a clean, generic interface to the Platform.
