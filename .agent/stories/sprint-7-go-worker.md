# Sprint 7: Go Temporal Worker

## Goal
Replace Python Temporal activities with Go-based activities using UCL connectors.

## Acceptance Criteria

### Core Activities
- [ ] `CollectCatalogSnapshots` - Fetch metadata via UCL `ListDatasets()`
- [ ] `PreviewDataset` - Sample data via UCL `Read()` with limit
- [ ] `PlanIngestionUnit` - Slice planning via UCL `PlanSlices()`
- [ ] `RunIngestionUnit` - Slice execution via UCL `ReadSlice()`

### Infrastructure
- [ ] Go Temporal worker on `metadata-go` task queue
- [ ] UCL connector registry bridge
- [ ] Staging provider abstraction (file/in_memory)

### Migration Support
- [ ] Feature flag: `USE_GO_WORKER` in workflows.ts
- [ ] Shadow mode for result comparison
- [ ] Gradual rollout support

## Codex Review Points
1. Activity timeout handling
2. Error serialization compatibility with TypeScript
3. Checkpoint format compatibility
4. Staging file format (JSON arrays)

## Files to Create
- `platform/ucl-worker/cmd/worker/main.go`
- `platform/ucl-worker/internal/activities/*.go`
- `platform/ucl-worker/internal/connector/registry.go`
