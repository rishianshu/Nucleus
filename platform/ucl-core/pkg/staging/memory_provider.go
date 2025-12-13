package staging

import (
	"context"
	"fmt"
	"sort"
	"sync"
)

type memoryStage struct {
	batches    map[string][]RecordEnvelope
	totalBytes int64
}

// MemoryProvider stores staged data in process memory with a strict byte cap.
type MemoryProvider struct {
	maxBytes int64

	mu     sync.Mutex
	stages map[string]*memoryStage
}

// NewMemoryProvider creates a memory-backed staging provider.
func NewMemoryProvider(maxBytes int64) *MemoryProvider {
	if maxBytes <= 0 {
		maxBytes = DefaultMemoryCapBytes
	}
	return &MemoryProvider{
		maxBytes: maxBytes,
		stages:   make(map[string]*memoryStage),
	}
}

func (p *MemoryProvider) ID() string { return ProviderMemory }

func (p *MemoryProvider) ensureStage(stageID string) *memoryStage {
	if stage, ok := p.stages[stageID]; ok {
		return stage
	}
	stage := &memoryStage{
		batches: make(map[string][]RecordEnvelope),
	}
	p.stages[stageID] = stage
	return stage
}

func (p *MemoryProvider) PutBatch(ctx context.Context, req *PutBatchRequest) (*PutBatchResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	stageID := resolveStageID(req.StageRef, req.StageID)
	if stageID == "" {
		stageID = NewStageID()
	}

	size, err := envelopeSizeBytes(req.Records)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	stage := p.ensureStage(stageID)
	if stage.totalBytes+size > p.maxBytes {
		return nil, &Error{Code: CodeStageTooLarge, Retryable: false, Err: fmt.Errorf("stage %s exceeds memory cap (%d bytes)", stageID, p.maxBytes)}
	}

	batchSeq := req.BatchSeq
	if batchSeq <= 0 {
		batchSeq = len(stage.batches)
	}
	batchRef := batchKey(req.SliceID, batchSeq)

	stage.batches[batchRef] = cloneEnvelopes(req.Records)
	stage.totalBytes += size

	return &PutBatchResult{
		StageRef: MakeStageRef(p.ID(), stageID),
		BatchRef: batchRef,
		Stats: BatchStats{
			Records: len(req.Records),
			Bytes:   size,
		},
	}, nil
}

func (p *MemoryProvider) ListBatches(ctx context.Context, stageRef string, _ string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := ParseStageRef(stageRef)

	p.mu.Lock()
	defer p.mu.Unlock()

	stage, ok := p.stages[stageID]
	if !ok {
		return []string{}, nil
	}

	refs := make([]string, 0, len(stage.batches))
	for ref := range stage.batches {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	return refs, nil
}

func (p *MemoryProvider) GetBatch(ctx context.Context, stageRef string, batchRef string) ([]RecordEnvelope, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := ParseStageRef(stageRef)

	p.mu.Lock()
	defer p.mu.Unlock()

	stage, ok := p.stages[stageID]
	if !ok {
		return nil, fmt.Errorf("stage not found: %s", stageID)
	}
	records, ok := stage.batches[batchRef]
	if !ok {
		return nil, fmt.Errorf("batch not found: %s", batchRef)
	}
	return cloneEnvelopes(records), nil
}

func (p *MemoryProvider) FinalizeStage(ctx context.Context, stageRef string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	_, stageID := ParseStageRef(stageRef)

	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.stages, stageID)
	return nil
}
