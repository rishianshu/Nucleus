package orchestration

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/staging"
)

// SinkRunRequest carries sink execution inputs.
type SinkRunRequest struct {
	SinkEndpointID    string
	EndpointConfig    map[string]any
	DatasetID         string
	Records           []endpoint.Record
	StageRef          string
	BatchRefs         []string
	StagingProviderID string
	Schema            *endpoint.Schema
	LoadDate          string
	Mode              string
}

// SinkRunner invokes a sink endpoint with provision + write semantics.
func SinkRunner(ctx context.Context, req SinkRunRequest) (*endpoint.WriteResult, error) {
	if req.SinkEndpointID == "" {
		return nil, fmt.Errorf("sinkEndpointId is required")
	}
	config := req.EndpointConfig
	if config == nil {
		config = map[string]any{}
	}
	ep, err := endpoint.Create(req.SinkEndpointID, config)
	if err != nil {
		return nil, err
	}
	defer ep.Close()
	sink, ok := ep.(endpoint.SinkEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint %s is not a sink", req.SinkEndpointID)
	}
	records := req.Records
	if len(records) == 0 && req.StageRef != "" && len(req.BatchRefs) > 0 {
		if req.StagingProviderID == "" {
			return nil, fmt.Errorf("stagingProviderId is required when using stageRef/batchRefs")
		}
		return writeFromStage(ctx, sink, req)
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("no records provided for sink %s", req.SinkEndpointID)
	}
	if err := sink.Provision(ctx, req.DatasetID, req.Schema); err != nil {
		return nil, err
	}
	writeReq := &endpoint.WriteRequest{
		DatasetID: req.DatasetID,
		Mode:      req.Mode,
		LoadDate:  req.LoadDate,
		Records:   records,
		Schema:    req.Schema,
	}
	return sink.WriteRaw(ctx, writeReq)
}

// writeFromStage streams staged batches to the sink without loading all records in memory.
func writeFromStage(ctx context.Context, sink endpoint.SinkEndpoint, req SinkRunRequest) (*endpoint.WriteResult, error) {
	provider, err := resolveStagingProvider(req.StageRef, req.StagingProviderID)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, fmt.Errorf("no staging provider resolved for %s", req.StagingProviderID)
	}
	if err := sink.Provision(ctx, req.DatasetID, req.Schema); err != nil {
		return nil, err
	}

	var totalRows int64
	var lastPath string
	for _, batchRef := range req.BatchRefs {
		envelopes, err := provider.GetBatch(ctx, req.StageRef, batchRef)
		if err != nil {
			return nil, fmt.Errorf("load staged batch %s: %w", batchRef, err)
		}
		if len(envelopes) == 0 {
			continue
		}
		records := make([]endpoint.Record, 0, len(envelopes))
		for _, env := range envelopes {
			if env.Payload != nil {
				records = append(records, endpoint.Record(env.Payload))
			}
		}
		if len(records) == 0 {
			continue
		}
		res, err := sink.WriteRaw(ctx, &endpoint.WriteRequest{
			DatasetID: req.DatasetID,
			Mode:      req.Mode,
			LoadDate:  req.LoadDate,
			Records:   records,
			Schema:    req.Schema,
		})
		if err != nil {
			return nil, err
		}
		totalRows += res.RowsWritten
		if res.Path != "" {
			lastPath = res.Path
		}
	}

	return &endpoint.WriteResult{
		RowsWritten: totalRows,
		Path:        lastPath,
	}, nil
}

// loadRecordsFromStage pulls staged envelopes and extracts payloads as endpoint records.
func loadRecordsFromStage(ctx context.Context, stageRef string, batchRefs []string, preferredProvider string) ([]endpoint.Record, error) {
	if stageRef == "" || len(batchRefs) == 0 {
		return nil, nil
	}
	provider, err := resolveStagingProvider(stageRef, preferredProvider)
	if err != nil {
		return nil, err
	}

	var records []endpoint.Record
	for _, ref := range batchRefs {
		envelopes, err := provider.GetBatch(ctx, stageRef, ref)
		if err != nil {
			return nil, fmt.Errorf("load staged batch %s: %w", ref, err)
		}
		for _, env := range envelopes {
			if env.Payload == nil {
				continue
			}
			records = append(records, endpoint.Record(env.Payload))
		}
	}
	return records, nil
}

func resolveStagingProvider(stageRef string, preferredProvider string) (staging.Provider, error) {
	providerID, _ := staging.ParseStageRef(stageRef)
	reg := DefaultStagingRegistry()

	candidates := []string{preferredProvider, providerID, staging.ProviderObjectStore, staging.ProviderMinIO, staging.ProviderMemory}
	for _, id := range candidates {
		if id == "" {
			continue
		}
		if p, ok := reg.Get(id); ok {
			return p, nil
		}
	}

	for _, id := range reg.ProviderIDs() {
		if p, ok := reg.Get(id); ok {
			return p, nil
		}
	}
	return nil, fmt.Errorf("no staging provider available for %s", providerID)
}
