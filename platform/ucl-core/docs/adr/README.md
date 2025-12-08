# Architecture Decision Records (ADRs)

This document contains formal ADRs for key architectural decisions in the Universal Connectivity Layer.

---

## ADR-001: Streaming gRPC for Large Data Ingestion

### Status
**Accepted**

### Context
The legacy `spark-ingestion` system loads entire datasets into Spark DataFrames before writing to sinks. This approach:
- Requires significant memory (entire dataset in memory)
- Has high latency (wait for full load before any writes)
- Couples the solution to Spark runtime
- Limits horizontal scaling (single Spark job)

For large ingestion jobs (>1M rows), this becomes a bottleneck.

### Decision
UCL will use **streaming gRPC** with backpressure for data transfer:

```protobuf
rpc Read(ReadRequest) returns (stream ReadResponse);
```

**Key Design Points:**
1. **Record-by-record streaming**: Each `ReadResponse` contains one record
2. **Backpressure**: gRPC flow control prevents memory overflow
3. **Batching at worker**: UCL Worker buffers N records before sink write
4. **Large file bypass**: For datasets >1GB, connector returns S3/GCS pointers instead of streaming

### Consequences
**Positive:**
- Lower memory footprint (O(batch_size) vs O(dataset_size))
- Early failure detection (abort on first bad record)
- Horizontal scaling (multiple workers reading slices)
- Runtime agnostic (no Spark dependency)

**Negative:**
- Slightly higher latency per-record (serialization overhead)
- Requires careful error handling (partial stream failures)
- Need to implement client-side batching

### Implementation Notes
```go
// Worker pseudocode
stream := connector.Read(request)
batch := make([]Record, 0, batchSize)
for {
    record, err := stream.Recv()
    if err == io.EOF {
        sink.WriteBatch(batch) // Flush remaining
        break
    }
    batch = append(batch, record)
    if len(batch) >= batchSize {
        sink.WriteBatch(batch)
        batch = batch[:0]
    }
}
```

---

## ADR-002: Separate Probing from Schema Fetch

### Status
**Accepted**

### Context
The legacy system often fetches full schema metadata when only needing simple statistics (e.g., "is this table empty?", "what's the max timestamp?").

`GetSchema` is expensive:
- Full column enumeration
- Constraint discovery
- Statistics per column

But probing only needs:
- Row count
- Max watermark value
- Table existence

### Decision
UCL separates lightweight probing from heavy schema fetch:

| Operation | RPC | Cost |
| :--- | :--- | :--- |
| "Is table empty?" | `GetStatistics(metrics=["row_count"])` | O(1) |
| "Max updated_at?" | `GetStatistics(metrics=["watermark"])` | O(1) |
| "Full schema" | `GetSchema()` | O(columns) |

### Consequences
**Positive:**
- Faster incremental planning (probe before plan)
- Reduced source database load
- Clearer API semantics

**Negative:**
- Two RPCs instead of one for full metadata
- Connector must implement both efficiently

### Implementation Notes
Connectors should optimize `GetStatistics`:
```sql
-- row_count (use table statistics, not COUNT(*))
SELECT num_rows FROM information_schema.tables WHERE ...

-- watermark (indexed column scan)
SELECT MAX(updated_at) FROM table WHERE ...
```

---

## ADR-003: Strategy as Orchestration, Not Connector Logic

### Status
**Accepted**

### Context
Legacy `FullRefreshStrategy` and `Scd1Strategy` classes contain:
1. Orchestration logic (slice iteration, watermark management)
2. Spark-specific code (DataFrame operations)
3. Sink-specific code (write modes)

This coupling makes strategies:
- Hard to test (require Spark)
- Hard to reuse (tied to specific runtime)
- Hard to extend (mix of concerns)

### Decision
UCL separates concerns:

| Layer | Responsibility | Implementation |
| :--- | :--- | :--- |
| **Connector** | Read, Write, PlanSlices | gRPC Service (stateless) |
| **Orchestration** | Strategy logic, slice iteration, watermark | Temporal Workflow |
| **Worker** | Stream processing, normalization, CDM | Go process |

**Temporal Workflow Pseudocode:**
```go
func FullRefreshWorkflow(ctx, req) {
    // 1. Plan
    plan := connector.PlanSlices(req)
    
    // 2. Execute each slice (can parallelize)
    for _, slice := range plan.Slices {
        result := workflow.ExecuteActivity(ctx, ReadAndWriteSlice, slice)
    }
    
    // 3. Finalize
    connector.Finalize(req)
}
```

### Consequences
**Positive:**
- Connectors are simple (only I/O)
- Strategies are reusable across any connector
- Temporal provides durability, retries, visibility

**Negative:**
- Additional infrastructure (Temporal cluster)
- Latency overhead for small jobs

---

## ADR-004: CDM as a Standalone Service

### Status
**Accepted**

### Context
Legacy CDM mapping is embedded in Python functions:
- `jira_work_mapper.py`
- `confluence_docs_mapper.py`

This approach:
- Ties CDM logic to specific endpoints
- Makes CDM mappings hard to version
- Requires code changes for mapping updates
- No caching of CDM lookups

### Decision
UCL implements CDM as a **standalone gRPC service**:

```protobuf
service CdmRegistryService {
    rpc ListModels(ListModelsRequest) returns (ListModelsResponse);
    rpc ApplyCdm(ApplyCdmRequest) returns (ApplyCdmResponse);
}
```

**Architecture:**
```
Raw Records → CDM Service → Typed CDM Records
                  ↓
         Registry Lookup
         (family, unit_id) → mapper
```

### Consequences
**Positive:**
- CDM mappings are versionable (separate deployment)
- Testable in isolation
- Cacheable (mapper lookup by key)
- Language agnostic (any connector can use)

**Negative:**
- Additional network hop
- Need to maintain mapping registry

### Implementation Notes
Mappings stored as configuration:
```yaml
mappings:
  - family: jira
    unit_id: jira_issues
    cdm_model: cdm.work.item
    mapper: jira_issue_to_work_item
```

---

## ADR-005: Metadata Caching with TTL

### Status
**Accepted**

### Context
Schema metadata is expensive to fetch but changes rarely. Legacy system uses file-based caching with manual TTL management.

### Decision
UCL Metadata Service provides:
1. **Cache-through interface**: `GetMetadata` checks cache first
2. **TTL configuration**: Per-target expiration
3. **Explicit invalidation**: `force_refresh` flag
4. **Distributed backend**: Redis/etcd for multi-worker sharing

```protobuf
message NeedsRefreshRequest {
    MetadataTarget target = 1;
}
message NeedsRefreshResponse {
    bool needs_refresh = 1;
    string expires_at = 2;
}
```

### Consequences
**Positive:**
- Reduced source load
- Faster repeated queries
- Predictable cache behavior

**Negative:**
- Stale data possible (within TTL)
- Cache invalidation complexity

---

## ADR-006: Schema Drift Detection as Middleware

### Status
**Accepted**

### Context
Schema drift detection currently runs in Python as a post-read validation. This happens after all data is read, wasting resources on invalid data.

### Decision
UCL implements drift detection as **streaming middleware**:

1. Worker receives schema expectation before read
2. First N records validated against schema
3. Drift detected → abort stream early
4. Policy determines action (fail, warn, adapt)

```protobuf
message SchemaDriftPolicy {
    bool require_snapshot = 1;
    bool allow_new_columns = 2;
    bool allow_missing_columns = 3;
    bool allow_type_mismatch = 4;
}
```

### Consequences
**Positive:**
- Early failure (abort on first drift)
- Lower resource waste
- Configurable tolerance

**Negative:**
- Requires schema snapshot before read
- Sampling may miss edge cases

---

## ADR-007: Go for Core, Python for Plugins

### Status
**Accepted**

### Context
Language choice affects:
- Performance (concurrency, memory)
- Developer experience (ecosystem, hiring)
- Deployment (binary vs runtime)
- Integration (existing Python endpoints)

### Decision
**Hybrid approach:**

| Component | Language | Rationale |
| :--- | :--- | :--- |
| Gateway | Go | High concurrency, gRPC native |
| Orchestration Worker | Go | Lightweight, Temporal SDK |
| Temporal Workflows | Go | Type safety, performance |
| Core Connectors (JDBC, HTTP) | Go | Performance critical |
| Legacy Connectors (Jira, Confluence) | Python | Preserve existing logic |
| CDM Mappers | Go (with CUE) | Declarative, versionable |

**Python Plugin Support:**
- Python connectors run as sidecar containers
- Communicate via local gRPC
- Shared proto definitions

### Consequences
**Positive:**
- Performance where it matters
- Preserve Python investment
- Modern tooling (Go modules, buf)

**Negative:**
- Two languages to maintain
- Sidecar complexity for Python
