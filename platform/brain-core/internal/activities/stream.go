package activities

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/orchestration"
	"github.com/nucleus/ucl-core/pkg/staging"
)

// streamDataset opens a SourceEndpoint and reads a dataset with optional checkpoint/limit. Caller must Close().
func streamDataset(ctx context.Context, sinkEndpointID string, cfg map[string]any, datasetSlug string, checkpoint map[string]any, limit int64) (endpoint.Iterator[endpoint.Record], func(), error) {
	ep, err := endpoint.Create(sinkEndpointID, cfg)
	if err != nil {
		return nil, func() {}, fmt.Errorf("create endpoint: %w", err)
	}
	source, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		ep.Close()
		return nil, func() {}, fmt.Errorf("endpoint %s does not implement SourceEndpoint", sinkEndpointID)
	}
	req := &endpoint.ReadRequest{DatasetID: datasetSlug}
	if checkpoint != nil {
		req.Checkpoint = checkpoint
	}
	if limit > 0 {
		req.Limit = limit
	}
	iter, err := source.Read(ctx, req)
	if err != nil {
		ep.Close()
		return nil, func() {}, fmt.Errorf("read dataset: %w", err)
	}
	closeFn := func() {
		_ = iter.Close()
		ep.Close()
	}
	return iter, closeFn, nil
}

// streamFromStaging replays staged envelopes directly from a staging provider using the shared registry.
// It understands the common checkpoint convention: map[string]any{"batchRef": "...", "recordOffset": int}.
func streamFromStaging(ctx context.Context, stagingProviderID string, stageRef string, sliceID string, datasetID string, checkpoint map[string]any, limit int64) (endpoint.Iterator[endpoint.Record], func(), error) {
	registry := orchestration.DefaultStagingRegistry()

	providerID := stagingProviderID
	if providerID == "" {
		providerID, _ = staging.ParseStageRef(stageRef)
	}
	if providerID == "" {
		providerID = staging.ProviderMemory
	}

	provider, ok := registry.Get(providerID)
	if !ok || provider == nil {
		return nil, func() {}, fmt.Errorf("staging provider %s not found", providerID)
	}

	if stageRef == "" {
		stageRef = staging.MakeStageRef(providerID, staging.NewStageID())
	}

	batchRefs, err := provider.ListBatches(ctx, stageRef, sliceID)
	if err != nil {
		return nil, func() {}, fmt.Errorf("list batches: %w", err)
	}

	cpBatch := ""
	cpOffset := -1
	if checkpoint != nil {
		if v, ok := checkpoint["batchRef"].(string); ok {
			cpBatch = v
		}
		if v, ok := checkpoint["recordOffset"].(int); ok {
			cpOffset = v
		} else if v, ok := checkpoint["recordOffset"].(float64); ok { // JSON numbers
			cpOffset = int(v)
		}
	}

	iter := &stagingIterator{
		ctx:              ctx,
		provider:         provider,
		stageRef:         stageRef,
		sliceID:          sliceID,
		batchRefs:        batchRefs,
		batchIdx:         0,
		checkpointBatch:  cpBatch,
		checkpointOffset: cpOffset,
		limit:            limit,
		datasetID:        datasetID,
	}
	return iter, func() {}, nil
}

// stagingIterator lazily reads batches from a staging provider and presents endpoint.Record values.
type stagingIterator struct {
	ctx              context.Context
	provider         staging.Provider
	stageRef         string
	sliceID          string
	batchRefs        []string
	batchIdx         int
	records          []staging.RecordEnvelope
	recordIdx        int
	current          endpoint.Record
	err              error
	checkpointBatch  string
	checkpointOffset int
	limit            int64
	consumed         int64
	baseOffset       int
	datasetID        string
	lastMapperKey    string
}

func (it *stagingIterator) Next() bool {
	if it.err != nil {
		return false
	}
	if it.limit > 0 && it.consumed >= it.limit {
		return false
	}

	for {
		// Consume buffered records if present.
		if it.recordIdx < len(it.records) {
			env := it.records[it.recordIdx]
			it.recordIdx++
			it.consumed++
			offset := it.baseOffset + (it.recordIdx - 1)
			recordKind := env.RecordKind
			entityKind := env.EntityKind
			payload := env.Payload
			rawPayload := env.Payload
			mapperKey := entityKind
			if mapperKey == "" {
				mapperKey = it.datasetID
			}
			if mapperKey != "" {
				if mapper, ok := endpoint.DefaultCDMRegistry().GetMapper(mapperKey); ok && recordKind != "cdm" {
					if mapped, mapErr := mapper(env.Payload); mapErr == nil {
						if m, ok := mapped.(map[string]any); ok {
							payload = m
							recordKind = "cdm"
							it.lastMapperKey = mapperKey
						}
					}
				}
			}
			it.current = map[string]any{
				"recordKind":    recordKind,
				"entityKind":    entityKind,
				"payload":       payload,
				"rawPayload":    rawPayload,
				"vectorPayload": env.VectorPayload,
				"source":        env.Source,
				"tenantId":      env.TenantID,
				"projectKey":    env.ProjectKey,
				"observedAt":    env.ObservedAt,
				"stageRef":      it.stageRef,
				"sliceId":       it.sliceID,
				"batchRef":      it.batchRefs[it.batchIdx-1],
				"recordOffset":  offset,
				"mapperKey":     mapperKey,
			}
			return true
		}

		// Load next batch.
		if it.batchIdx >= len(it.batchRefs) {
			return false
		}
		batchRef := it.batchRefs[it.batchIdx]
		it.batchIdx++

		// Apply checkpoint skip.
		if it.checkpointBatch != "" {
			if batchRef < it.checkpointBatch {
				continue
			}
		}

		recs, err := it.provider.GetBatch(it.ctx, it.stageRef, batchRef)
		if err != nil {
			it.err = fmt.Errorf("get batch %s: %w", batchRef, err)
			return false
		}

		// If checkpoint matches this batch, skip offsets.
		startOffset := 0
		if it.checkpointBatch != "" && batchRef == it.checkpointBatch && it.checkpointOffset >= 0 {
			if it.checkpointOffset < len(recs)-1 {
				recs = recs[it.checkpointOffset+1:]
				startOffset = it.checkpointOffset + 1
			} else {
				recs = nil
			}
		}

		if len(recs) == 0 {
			continue
		}

		it.records = recs
		it.recordIdx = 0
		it.baseOffset = startOffset
	}
}

func (it *stagingIterator) Value() endpoint.Record { return it.current }

func (it *stagingIterator) Err() error { return it.err }

func (it *stagingIterator) Close() error { return nil }
