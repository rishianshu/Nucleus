# UCL Implementation Stories (V2 - Complete)

This document contains **comprehensive implementation stories** covering:
- **Python Deprecation Milestones**
- **ALL Connectors** (JDBC, Jira, Confluence, OneDrive, Kafka, HDFS, Iceberg)
- **Strengthened Technical Notes**

---

## Milestone Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         UCL TRANSITION TIMELINE                           │
├───────────────────────────────────────────────────────────────────────────┤
│  M1: Foundation       │  M2: Data Plane      │  M3: Full Parity          │
│  (Sprint 1-2)         │  (Sprint 3-6)        │  (Sprint 7-10)            │
│                       │                       │                           │
│  • Go Gateway         │  • JDBC Connector    │  • All Connectors Go      │
│  • Proto Generation   │  • Orchestration     │  • Python Deprecated      │
│  • Registry           │  • CDM Service       │  • Legacy Removed         │
├───────────────────────┼───────────────────────┼───────────────────────────┤
│  PYTHON: Active       │  PYTHON: Parallel    │  PYTHON: Deprecated       │
│  (spark-ingestion)    │  (UCL shadow mode)   │  (read-only)              │
└───────────────────────┴───────────────────────┴───────────────────────────┘
```

---

## Epic 1: Foundation

### Story 1.1: Project Setup & Proto Generation
**Priority**: P0 | **Points**: 5 | **Sprint**: 1

**Description**:
Set up UCL with `buf` for proto generation and basic project structure.

**Acceptance Criteria**:
- [ ] `buf.yaml` configured with lint rules
- [ ] `buf.gen.yaml` generates Go + TypeScript stubs
- [ ] CI runs `buf lint` and `buf breaking` on PRs
- [ ] Generated code in `gen/go/` and `gen/ts/`
- [ ] Makefile: `make proto`, `make lint`, `make test`

**Technical Notes**:
```yaml
# buf.yaml
version: v1
breaking:
  use:
    - FILE
lint:
  use:
    - DEFAULT
  except:
    - PACKAGE_VERSION_SUFFIX

# buf.gen.yaml
version: v1
plugins:
  - plugin: go
    out: gen/go
    opt: paths=source_relative
  - plugin: go-grpc
    out: gen/go
    opt: paths=source_relative
  - plugin: ts
    out: gen/ts
    opt: esModuleInterop=true
```

**File Structure**:
```
platform/ucl-core/
├── api/v1/
│   ├── gateway.proto
│   ├── connector.proto
│   ├── orchestration.proto
│   ├── cdm.proto
│   └── metadata.proto
├── buf.yaml
├── buf.gen.yaml
├── gen/
│   ├── go/
│   └── ts/
├── cmd/
│   ├── ucl-gateway/
│   └── ucl-worker/
├── internal/
│   ├── gateway/
│   ├── connector/
│   ├── orchestration/
│   └── cdm/
└── Makefile
```

---

### Story 1.2: Gateway Server Skeleton
**Priority**: P0 | **Points**: 5 | **Sprint**: 1

**Description**:
Implement gRPC Gateway server with health checks, interceptors, and metrics.

**Acceptance Criteria**:
- [ ] Server starts on configurable port
- [ ] Health check returns SERVING
- [ ] All RPC handlers return codes.Unimplemented initially
- [ ] Request logging interceptor (zap structured logs)
- [ ] Prometheus metrics endpoint `/metrics`
- [ ] Graceful shutdown on SIGTERM (30s drain)

**Technical Notes**:
```go
// cmd/ucl-gateway/main.go
func main() {
    cfg := loadConfig()
    
    // gRPC server with interceptors
    server := grpc.NewServer(
        grpc.ChainUnaryInterceptor(
            logging.UnaryServerInterceptor(logger),
            recovery.UnaryServerInterceptor(),
            prometheus.UnaryServerInterceptor,
        ),
        grpc.ChainStreamInterceptor(
            logging.StreamServerInterceptor(logger),
            recovery.StreamServerInterceptor(),
        ),
    )
    
    // Register services
    gatewayv1.RegisterGatewayServiceServer(server, gateway.NewService(cfg))
    grpc_health_v1.RegisterHealthServer(server, health.NewServer())
    
    // Start server
    lis, _ := net.Listen("tcp", cfg.Address)
    go server.Serve(lis)
    
    // Graceful shutdown
    <-signals.Wait()
    server.GracefulStop()
}
```

**Metrics**:
```go
var (
    rpcRequests = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "ucl_gateway_rpc_requests_total",
    }, []string{"method", "code"})
    
    rpcDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name: "ucl_gateway_rpc_duration_seconds",
        Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
    }, []string{"method"})
)
```

---

### Story 1.3: Connector Registry & Pool
**Priority**: P0 | **Points**: 5 | **Sprint**: 2

**Description**:
Implement connector registry with connection pooling and health checking.

**Acceptance Criteria**:
- [ ] Registry stores connector factories by template ID
- [ ] Connection pool with configurable max connections
- [ ] Idle timeout eviction (default 5m)
- [ ] Health check all connections on interval
- [ ] Support embedded (in-process) and external (gRPC) connectors

**Technical Notes**:
```go
// internal/gateway/registry/pool.go
type Pool struct {
    mu       sync.RWMutex
    conns    map[string]*pooledConn
    maxIdle  int
    maxOpen  int
    idleTime time.Duration
}

type pooledConn struct {
    conn      *grpc.ClientConn
    lastUsed  time.Time
    inUse     int32
    endpointID string
}

func (p *Pool) Acquire(ctx context.Context, endpointID string, config *structpb.Struct) (*grpc.ClientConn, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    
    if pc, ok := p.conns[endpointID]; ok && atomic.AddInt32(&pc.inUse, 1) <= 1 {
        pc.lastUsed = time.Now()
        return pc.conn, nil
    }
    
    // Create new connection
    factory, err := p.registry.GetFactory(endpointID)
    if err != nil {
        return nil, err
    }
    
    conn, err := factory.Connect(ctx, config)
    if err != nil {
        return nil, err
    }
    
    p.conns[endpointID] = &pooledConn{
        conn:       conn,
        lastUsed:   time.Now(),
        inUse:      1,
        endpointID: endpointID,
    }
    
    return conn, nil
}
```

---

## Epic 2: JDBC Connector

### Story 2.1: JDBC Connector - ValidateConfig & GetCapabilities
**Priority**: P0 | **Points**: 3 | **Sprint**: 2

**Description**:
Implement JDBC connector lifecycle RPCs.

**Acceptance Criteria**:
- [ ] `ValidateConfig` connects and returns version
- [ ] `GetCapabilities` returns full capability struct
- [ ] `GetDescriptor` returns JDBC field descriptors
- [ ] Supports Postgres, MySQL, Oracle, MSSQL drivers

**Technical Notes**:
```go
// internal/connector/jdbc/service.go
func (s *Service) ValidateConfig(ctx context.Context, req *connectorv1.ValidateConfigRequest) (*connectorv1.ValidateConfigResponse, error) {
    config := parseConfig(req.Config)
    
    // Connect with timeout
    db, err := sql.Open(config.Driver, config.ConnectionString)
    if err != nil {
        return &connectorv1.ValidateConfigResponse{Valid: false, Message: err.Error()}, nil
    }
    defer db.Close()
    
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    
    if err := db.PingContext(ctx); err != nil {
        return &connectorv1.ValidateConfigResponse{Valid: false, Message: err.Error()}, nil
    }
    
    // Get version
    var version string
    db.QueryRowContext(ctx, "SELECT version()").Scan(&version)
    
    return &connectorv1.ValidateConfigResponse{
        Valid:           true,
        DetectedVersion: version,
    }, nil
}

func (s *Service) GetCapabilities(ctx context.Context, req *connectorv1.GetCapabilitiesRequest) (*connectorv1.GetCapabilitiesResponse, error) {
    return &connectorv1.GetCapabilitiesResponse{
        SupportsFull:        true,
        SupportsIncremental: true,
        SupportsCountProbe:  true,
        SupportsPreview:     true,
        SupportsMetadata:    true,
        DefaultFetchsize:    10000,
    }, nil
}
```

---

### Story 2.2: JDBC Connector - Schema & Statistics
**Priority**: P0 | **Points**: 5 | **Sprint**: 3

**Description**:
Implement schema discovery and statistics for JDBC.

**Acceptance Criteria**:
- [ ] `ListDatasets` returns tables/views
- [ ] `GetSchema` returns columns with types, constraints
- [ ] `GetStatistics` returns row count, table size
- [ ] Supports information_schema queries

**Technical Notes**:
```sql
-- ListDatasets (Postgres)
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;

-- GetSchema (Postgres)
SELECT 
    column_name,
    data_type,
    is_nullable,
    numeric_precision,
    numeric_scale,
    character_maximum_length,
    column_default
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position;

-- GetStatistics (Postgres - fast estimate)
SELECT 
    reltuples::bigint AS row_count,
    pg_total_relation_size(c.oid) AS size_bytes
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1 AND c.relname = $2;
```

---

### Story 2.3: JDBC Connector - Read & PlanSlices
**Priority**: P0 | **Points**: 8 | **Sprint**: 3

**Description**:
Implement streaming read and adaptive slice planning.

**Acceptance Criteria**:
- [ ] `Read` streams records via gRPC
- [ ] Supports slice-based WHERE clause
- [ ] `PlanSlices` divides by ID or timestamp
- [ ] Handles all common SQL types (string, int, float, timestamp, bool)

**Technical Notes**:
```go
func (s *Service) Read(req *connectorv1.ReadRequest, stream connectorv1.ConnectorService_ReadServer) error {
    query := s.buildQuery(req.DatasetId, req.Slice, req.Limit)
    
    rows, err := s.db.QueryContext(stream.Context(), query)
    if err != nil {
        return status.Errorf(codes.Internal, "query failed: %v", err)
    }
    defer rows.Close()
    
    cols, _ := rows.Columns()
    for rows.Next() {
        values := make([]interface{}, len(cols))
        valuePtrs := make([]interface{}, len(cols))
        for i := range values {
            valuePtrs[i] = &values[i]
        }
        
        if err := rows.Scan(valuePtrs...); err != nil {
            return status.Errorf(codes.Internal, "scan failed: %v", err)
        }
        
        record, _ := structpb.NewStruct(toMap(cols, values))
        if err := stream.Send(&connectorv1.ReadResponse{Record: record}); err != nil {
            return err
        }
    }
    
    return nil
}

func (s *Service) PlanSlices(ctx context.Context, req *connectorv1.PlanSlicesRequest) (*connectorv1.PlanSlicesResponse, error) {
    bounds := parseBounds(req.Bounds)
    
    // Get row count for adaptive planning
    stats, _ := s.GetStatistics(ctx, &connectorv1.GetStatisticsRequest{
        Config:    req.Config,
        DatasetId: req.DatasetId,
        Metrics:   []string{"row_count"},
        Filter:    req.Bounds,
    })
    
    rowCount := stats.Stats.Fields["row_count"].GetNumberValue()
    targetSliceSize := int64(100000) // 100k rows per slice
    numSlices := max(1, int(rowCount/float64(targetSliceSize)))
    
    slices := make([]*connectorv1.IngestionSlice, numSlices)
    // Divide bounds into equal parts
    // ...
    
    return &connectorv1.PlanSlicesResponse{
        Slices:       slices,
        StrategyUsed: req.Strategy,
    }, nil
}
```

---

## Epic 3: Jira Connector

### Story 3.1: Jira Connector - Discovery & Schema
**Priority**: P0 | **Points**: 5 | **Sprint**: 4

**Description**:
Implement Jira connector with project/issue discovery.

**Acceptance Criteria**:
- [ ] `ValidateConfig` tests Jira API connection
- [ ] `ListDatasets` returns semantic units (jira_projects, jira_issues, jira_users)
- [ ] `GetSchema` returns Jira field definitions
- [ ] CDM model IDs populated (cdm.work.project, cdm.work.item)

**Technical Notes**:
```go
// Jira API client wrapper
type JiraClient struct {
    baseURL    string
    httpClient *http.Client
    auth       AuthConfig
}

func (c *JiraClient) GetProjects(ctx context.Context) ([]Project, error) {
    resp, err := c.get(ctx, "/rest/api/3/project")
    // Parse JSON response
}

func (s *JiraService) ListDatasets(ctx context.Context, req *connectorv1.ListDatasetsRequest) (*connectorv1.ListDatasetsResponse, error) {
    return &connectorv1.ListDatasetsResponse{
        Datasets: []*connectorv1.DatasetItem{
            {
                Id: "jira_projects", Name: "Projects",
                Kind: "semantic", CdmModelId: "cdm.work.project",
            },
            {
                Id: "jira_issues", Name: "Issues",
                Kind: "semantic", CdmModelId: "cdm.work.item",
                SupportsIncremental: true,
                IncrementalColumn: "updated",
                IncrementalLiteral: "timestamp",
            },
            {
                Id: "jira_users", Name: "Users",
                Kind: "semantic", CdmModelId: "cdm.work.user",
            },
        },
    }, nil
}
```

---

### Story 3.2: Jira Connector - Incremental Read
**Priority**: P0 | **Points**: 8 | **Sprint**: 4

**Description**:
Implement JQL-based incremental reading with pagination.

**Acceptance Criteria**:
- [ ] `Read` fetches issues via JQL search
- [ ] Supports incremental via `updated >= watermark`
- [ ] Handles pagination (startAt/maxResults)
- [ ] Expands fields (changelog, comments, worklogs)

**Technical Notes**:
```go
func (s *JiraService) Read(req *connectorv1.ReadRequest, stream connectorv1.ConnectorService_ReadServer) error {
    // Build JQL from slice params
    jql := s.buildJQL(req.DatasetId, req.Slice)
    // e.g., "project = 'ENG' AND updated >= '2024-01-01' ORDER BY updated ASC"
    
    startAt := 0
    maxResults := 100
    
    for {
        resp, err := s.client.SearchIssues(stream.Context(), SearchRequest{
            JQL:        jql,
            StartAt:    startAt,
            MaxResults: maxResults,
            Expand:     []string{"changelog", "renderedFields"},
        })
        if err != nil {
            return status.Errorf(codes.Internal, "jira search failed: %v", err)
        }
        
        for _, issue := range resp.Issues {
            record, _ := structpb.NewStruct(issueToMap(issue))
            if err := stream.Send(&connectorv1.ReadResponse{Record: record}); err != nil {
                return err
            }
        }
        
        startAt += len(resp.Issues)
        if startAt >= resp.Total {
            break
        }
    }
    
    return nil
}

func (s *JiraService) buildJQL(datasetID string, slice *connectorv1.IngestionSlice) string {
    if slice == nil {
        return "ORDER BY updated ASC"
    }
    
    params := slice.SliceParams.AsMap()
    var clauses []string
    
    if project, ok := params["project"].(string); ok {
        clauses = append(clauses, fmt.Sprintf("project = '%s'", project))
    }
    if lower, ok := params["lower_bound"].(string); ok {
        clauses = append(clauses, fmt.Sprintf("updated >= '%s'", lower))
    }
    if upper, ok := params["upper_bound"].(string); ok {
        clauses = append(clauses, fmt.Sprintf("updated <= '%s'", upper))
    }
    
    return strings.Join(clauses, " AND ") + " ORDER BY updated ASC"
}
```

---

### Story 3.3: Jira Actions
**Priority**: P1 | **Points**: 8 | **Sprint**: 9

**Description**:
Implement Jira write-back actions.

**Acceptance Criteria**:
- [ ] `Execute("create_issue", ...)` creates new issue
- [ ] `Execute("transition_issue", ...)` changes status
- [ ] `Execute("add_comment", ...)` adds comment
- [ ] `Execute("update_issue", ...)` updates fields
- [ ] Input validation against Jira field metadata

**Technical Notes**:
```go
func (s *JiraService) Execute(ctx context.Context, req *connectorv1.ExecuteRequest) (*connectorv1.ExecuteResponse, error) {
    switch req.Action {
    case "create_issue":
        return s.createIssue(ctx, req.Parameters)
    case "transition_issue":
        return s.transitionIssue(ctx, req.Parameters)
    case "add_comment":
        return s.addComment(ctx, req.Parameters)
    case "update_issue":
        return s.updateIssue(ctx, req.Parameters)
    default:
        return nil, status.Errorf(codes.InvalidArgument, "unknown action: %s", req.Action)
    }
}

func (s *JiraService) createIssue(ctx context.Context, params *structpb.Struct) (*connectorv1.ExecuteResponse, error) {
    p := params.AsMap()
    
    body := map[string]interface{}{
        "fields": map[string]interface{}{
            "project":     map[string]string{"key": p["project_key"].(string)},
            "summary":     p["summary"],
            "description": p["description"],
            "issuetype":   map[string]string{"name": p["issue_type"].(string)},
        },
    }
    
    issue, err := s.client.CreateIssue(ctx, body)
    if err != nil {
        return nil, status.Errorf(codes.Internal, "create failed: %v", err)
    }
    
    result, _ := structpb.NewStruct(map[string]interface{}{
        "key":  issue.Key,
        "id":   issue.ID,
        "self": issue.Self,
    })
    
    return &connectorv1.ExecuteResponse{Result: result}, nil
}
```

---

## Epic 4: Confluence Connector

### Story 4.1: Confluence Connector - Discovery
**Priority**: P1 | **Points**: 5 | **Sprint**: 5

**Description**:
Implement Confluence connector with space/page discovery.

**Acceptance Criteria**:
- [ ] `ValidateConfig` tests Confluence API connection
- [ ] `ListDatasets` returns spaces, pages, attachments
- [ ] `GetSchema` returns page/space field definitions
- [ ] CDM model IDs: cdm.docs.item, cdm.docs.space

**Technical Notes**:
```go
func (s *ConfluenceService) ListDatasets(ctx context.Context, req *connectorv1.ListDatasetsRequest) (*connectorv1.ListDatasetsResponse, error) {
    return &connectorv1.ListDatasetsResponse{
        Datasets: []*connectorv1.DatasetItem{
            {
                Id: "confluence_spaces", Name: "Spaces",
                Kind: "semantic", CdmModelId: "cdm.docs.space",
            },
            {
                Id: "confluence_pages", Name: "Pages",
                Kind: "semantic", CdmModelId: "cdm.docs.item",
                SupportsIncremental: true,
                IncrementalColumn: "version.when",
            },
            {
                Id: "confluence_attachments", Name: "Attachments",
                Kind: "semantic", CdmModelId: "cdm.docs.link",
            },
        },
    }, nil
}
```

---

### Story 4.2: Confluence Connector - Read
**Priority**: P1 | **Points**: 8 | **Sprint**: 5

**Description**:
Implement Confluence page/space reading.

**Acceptance Criteria**:
- [ ] `Read` fetches pages from space
- [ ] Supports incremental via version.when
- [ ] Expands body.storage for content
- [ ] Fetches attachments per page

---

## Epic 5: OneDrive Connector

### Story 5.1: OneDrive Connector - Graph API Integration
**Priority**: P1 | **Points**: 8 | **Sprint**: 6

**Description**:
Implement OneDrive connector using Microsoft Graph API.

**Acceptance Criteria**:
- [ ] OAuth2 authentication flow
- [ ] `ListDatasets` returns drives/folders
- [ ] `Read` fetches file metadata
- [ ] Supports delta tokens for incremental

**Technical Notes**:
```go
// Graph API delta query
// GET /me/drive/root/delta
// Returns delta link for next sync

func (s *OneDriveService) Read(req *connectorv1.ReadRequest, stream connectorv1.ConnectorService_ReadServer) error {
    deltaLink := s.getCheckpoint(req.Slice)
    
    for {
        resp, err := s.graph.Delta(stream.Context(), deltaLink)
        if err != nil {
            return err
        }
        
        for _, item := range resp.Value {
            record := s.itemToRecord(item)
            stream.Send(&connectorv1.ReadResponse{Record: record})
        }
        
        if resp.NextLink == "" {
            break
        }
        deltaLink = resp.NextLink
    }
    
    return nil
}
```

---

## Epic 6: Kafka Connector

### Story 6.1: Kafka Connector - Topic Discovery & Sample
**Priority**: P2 | **Points**: 5 | **Sprint**: 7

**Description**:
Implement Kafka connector for topic metadata and sampling.

**Acceptance Criteria**:
- [ ] `ListDatasets` returns topics
- [ ] `GetSchema` returns topic schema (if Schema Registry)
- [ ] `Read` supports sample mode (N messages)

---

## Epic 7: Sink Connectors

### Story 7.1: HDFS/Parquet Sink
**Priority**: P1 | **Points**: 8 | **Sprint**: 6

**Description**:
Port HDFS Parquet sink to UCL.

**Acceptance Criteria**:
- [ ] `WriteRaw` writes Parquet to HDFS/S3
- [ ] `StageSlice` stages incremental batches
- [ ] `CommitIncremental` merges staged files
- [ ] `Finalize` registers Hive table

---

### Story 7.2: Iceberg Sink
**Priority**: P2 | **Points**: 8 | **Sprint**: 8

**Description**:
Implement Iceberg table writes.

**Acceptance Criteria**:
- [ ] Write to Iceberg tables
- [ ] Support merge-on-read
- [ ] Partition by configurable column
- [ ] Schema evolution support

---

## Epic 8: Python Deprecation

### Story 8.1: Shadow Mode - Dual Execution
**Priority**: P0 | **Points**: 5 | **Sprint**: 8

**Description**:
Run UCL in shadow mode alongside Python spark-ingestion.

**Acceptance Criteria**:
- [ ] Feature flag enables dual execution
- [ ] Compare results between UCL and Python
- [ ] Log discrepancies for analysis
- [ ] No production impact from UCL failures

---

### Story 8.2: Python Read-Only Mode
**Priority**: P0 | **Points**: 3 | **Sprint**: 9

**Description**:
Switch Python to read-only (no new features).

**Acceptance Criteria**:
- [ ] DEPRECATED banner in Python codebase
- [ ] CI rejects non-bugfix changes
- [ ] Documentation updated

---

### Story 8.3: Python Removal
**Priority**: P0 | **Points**: 5 | **Sprint**: 10

**Description**:
Remove Python spark-ingestion from production.

**Acceptance Criteria**:
- [ ] All connectors ported to UCL
- [ ] All tests passing in UCL
- [ ] spark-ingestion archived
- [ ] Documentation updated

---

## Sprint Planning Matrix (Updated)

| Sprint | Focus | Stories | Points |
| :--- | :--- | :--- | :--- |
| **1** | Foundation | 1.1, 1.2 | 10 |
| **2** | Foundation + JDBC | 1.3, 2.1 | 8 |
| **3** | JDBC | 2.2, 2.3 | 13 |
| **4** | Jira | 3.1, 3.2 | 13 |
| **5** | Confluence | 4.1, 4.2 | 13 |
| **6** | OneDrive + HDFS | 5.1, 7.1 | 16 |
| **7** | Kafka + Orchestration | 6.1, 3.4 | 10 |
| **8** | Iceberg + Shadow | 7.2, 8.1 | 13 |
| **9** | Jira Actions + Deprecation | 3.3, 8.2 | 11 |
| **10** | Python Removal | 8.3 | 5 |

**Total**: ~112 points across 10 sprints

---

## Python Deprecation Timeline

| Milestone | Sprint | Date (Est.) | State |
| :--- | :--- | :--- | :--- |
| UCL Foundation Complete | 2 | +4 weeks | Python: Active |
| JDBC Connector Parity | 3 | +6 weeks | Python: Active |
| Jira Connector Parity | 4 | +8 weeks | Python: Active |
| Shadow Mode Enabled | 8 | +16 weeks | Python: Parallel |
| Python Read-Only | 9 | +18 weeks | Python: Deprecated |
| Python Removed | 10 | +20 weeks | Python: Archived |
