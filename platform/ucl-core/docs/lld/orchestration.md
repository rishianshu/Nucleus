# Low-Level Design: UCL Orchestration Service

## 1. Overview
The Orchestration Service manages **ingestion strategies** and **workflow execution**. It uses Temporal for durable, resumable workflows.

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Orchestration Service                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │ Strategy Service│  │     Temporal Worker             │   │
│  │    (gRPC)       │  │                                 │   │
│  │                 │  │  ┌──────────┐ ┌──────────────┐  │   │
│  │ ListStrategies  │  │  │FullRefr  │ │  SCD1        │  │   │
│  │ RunIngestion    │──┼─▶│ Workflow │ │  Workflow    │  │   │
│  │                 │  │  └────┬─────┘ └──────┬───────┘  │   │
│  └─────────────────┘  │       │              │          │   │
│                       │  ┌────┴──────────────┴────┐     │   │
│                       │  │      Activities        │     │   │
│                       │  │  • ReadSlice           │     │   │
│                       │  │  • WriteSlice          │     │   │
│                       │  │  • ValidateSchema      │     │   │
│                       │  │  • ApplyCDM            │     │   │
│                       │  └────────────────────────┘     │   │
│                       └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
   ┌──────────┐         ┌──────────┐         ┌──────────┐
   │ Connector│         │   CDM    │         │ Metadata │
   │ Service  │         │ Service  │         │ Service  │
   └──────────┘         └──────────┘         └──────────┘
```

---

## 2. Package Structure

```
cmd/ucl-orchestration/
├── main.go              # Entry point
└── worker.go            # Temporal worker setup

internal/orchestration/
├── service.go           # IngestionStrategyService impl
├── strategies/
│   ├── registry.go      # Strategy registry
│   ├── full.go          # FullRefreshWorkflow
│   └── scd1.go          # Scd1Workflow
├── activities/
│   ├── read.go          # ReadSliceActivity
│   ├── write.go         # WriteSliceActivity
│   ├── validate.go      # ValidateSchemaActivity
│   └── cdm.go           # ApplyCdmActivity
└── middleware/
    ├── drift.go         # Schema drift detection
    └── guardrail.go     # Precision guardrails
```

---

## 3. Workflow Definitions

### 3.1 Full Refresh Workflow
```go
func FullRefreshWorkflow(ctx workflow.Context, req *RunIngestionRequest) (*IngestionResult, error) {
    // 1. Validate configuration
    validateResult := workflow.ExecuteActivity(ctx, ValidateConfigActivity, req)
    if validateResult.Error != nil {
        return nil, validateResult.Error
    }
    
    // 2. Get schema and apply drift policy
    schemaResult := workflow.ExecuteActivity(ctx, GetSchemaActivity, req)
    driftResult := workflow.ExecuteActivity(ctx, CheckDriftActivity, schemaResult, req.DriftPolicy)
    if driftResult.Status == "failed" {
        return nil, ErrSchemaDrift
    }
    
    // 3. Plan slices (for large tables)
    planResult := workflow.ExecuteActivity(ctx, PlanSlicesActivity, req)
    
    // 4. Send progress event
    workflow.SignalExternalWorkflow(ctx, "progress", IngestionPlanEvent{
        TotalSlices: len(planResult.Slices),
        EstimatedRows: planResult.EstimatedRows,
    })
    
    // 5. Execute slices (parallel with concurrency limit)
    results := make([]SliceResult, len(planResult.Slices))
    for i, slice := range planResult.Slices {
        future := workflow.ExecuteActivity(ctx, ReadAndWriteSliceActivity, ReadWriteInput{
            Request: req,
            Slice:   slice,
        })
        results[i] = future.Get()
    }
    
    // 6. Finalize
    finalResult := workflow.ExecuteActivity(ctx, FinalizeActivity, req)
    
    return &IngestionResult{
        TotalRows:    sumRows(results),
        FinalPath:    finalResult.Path,
        NewWatermark: finalResult.Watermark,
    }, nil
}
```

### 3.2 SCD1 (Incremental) Workflow
```go
func Scd1Workflow(ctx workflow.Context, req *RunIngestionRequest) (*IngestionResult, error) {
    // 1. Get last watermark
    watermark := workflow.ExecuteActivity(ctx, GetLatestWatermarkActivity, req)
    
    // 2. Probe for row count
    stats := workflow.ExecuteActivity(ctx, ProbeStatisticsActivity, ProbeInput{
        EndpointID: req.EndpointId,
        DatasetID:  req.DatasetId,
        Metrics:    []string{"row_count"},
        Filter:     map[string]any{"lower": watermark.Value},
    })
    
    // 3. Adaptive planning
    plan := workflow.ExecuteActivity(ctx, AdaptivePlanActivity, AdaptivePlanInput{
        Request:      req,
        EstimatedRows: stats.RowCount,
        LastWatermark: watermark.Value,
    })
    
    // 4. Execute slices with staging
    stagedResults := []StageSliceResult{}
    for _, slice := range plan.Slices {
        result := workflow.ExecuteActivity(ctx, StageSliceActivity, StageInput{
            Request: req,
            Slice:   slice,
            Context: IncrementalContext{
                LastWatermark: watermark.Value,
            },
        })
        stagedResults = append(stagedResults, result)
    }
    
    // 5. Commit (merge/upsert)
    commitResult := workflow.ExecuteActivity(ctx, CommitIncrementalActivity, CommitInput{
        Request:      req,
        StagedSlices: stagedResults,
    })
    
    return &IngestionResult{
        TotalRows:    commitResult.TotalRows,
        NewWatermark: commitResult.NewWatermark,
    }, nil
}
```

---

## 4. Activities

### 4.1 ReadSliceActivity
```go
func ReadSliceActivity(ctx context.Context, input ReadSliceInput) (*ReadSliceResult, error) {
    // Get connector
    conn := registry.Get(input.EndpointID)
    
    // Start streaming read
    stream, err := conn.Read(ctx, &ReadRequest{
        Config:    input.Config,
        DatasetId: input.DatasetID,
        Slice:     input.Slice,
    })
    if err != nil {
        return nil, fmt.Errorf("read stream failed: %w", err)
    }
    
    // Collect records (with limit for memory safety)
    records := make([]*structpb.Struct, 0, input.BatchSize)
    for {
        resp, err := stream.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            return nil, err
        }
        records = append(records, resp.Record)
        
        if len(records) >= input.BatchSize {
            // Yield batch (for large datasets)
            break
        }
    }
    
    return &ReadSliceResult{
        Records: records,
        HasMore: len(records) == input.BatchSize,
    }, nil
}
```

### 4.2 ValidateSchemaActivity
```go
func ValidateSchemaActivity(ctx context.Context, input ValidateInput) (*ValidateResult, error) {
    // Fetch expected schema
    metadataClient := metadata.NewClient()
    expected, err := metadataClient.GetMetadata(ctx, &GetMetadataRequest{
        Target: input.Target,
        Kind:   "schema",
    })
    
    // Compare with actual
    actual := input.ObservedSchema
    
    result := &SchemaDriftResult{}
    
    // Check new columns
    for _, field := range actual.Fields {
        if !containsField(expected, field.Name) {
            result.NewColumns = append(result.NewColumns, field.Name)
        }
    }
    
    // Check missing columns
    for _, field := range expected.Fields {
        if !containsField(actual, field.Name) {
            result.MissingColumns = append(result.MissingColumns, field.Name)
        }
    }
    
    // Apply policy
    if !input.Policy.AllowNewColumns && len(result.NewColumns) > 0 {
        return &ValidateResult{Status: "failed", Drift: result}, nil
    }
    if !input.Policy.AllowMissingColumns && len(result.MissingColumns) > 0 {
        return &ValidateResult{Status: "failed", Drift: result}, nil
    }
    
    return &ValidateResult{Status: "ok", Drift: result}, nil
}
```

---

## 5. Configuration

```yaml
orchestration:
  temporal:
    host: temporal:7233
    namespace: ucl-prod
    task_queue: ucl-orchestration
    
    # Workflow timeouts
    workflow_execution_timeout: 24h
    workflow_run_timeout: 12h
    
    # Retry policy
    retry:
      initial_interval: 1s
      backoff_coefficient: 2.0
      maximum_interval: 5m
      maximum_attempts: 5
  
  strategies:
    full:
      enabled: true
      default_batch_size: 10000
    scd1:
      enabled: true
      default_slice_target: 100000
      max_parallel_slices: 4
  
  # CDM integration
  cdm:
    enabled: true
    service_address: ucl-cdm:50053
  
  # Metadata integration  
  metadata:
    enabled: true
    service_address: ucl-metadata:50054
```

---

## 6. Observability

### Temporal UI
- Workflow history
- Activity timelines
- Error details with stack traces
- Retry counts

### Custom Metrics
```
ucl_orchestration_workflows_active{strategy}
ucl_orchestration_workflow_duration_seconds{strategy, status}
ucl_orchestration_slices_processed_total{strategy}
ucl_orchestration_rows_processed_total{strategy, direction}
ucl_orchestration_drift_detected_total{type}
```
