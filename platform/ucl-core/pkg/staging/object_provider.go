package staging

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// ObjectStoreProvider stores batches on disk under a deterministic prefix to mimic an object store.
type ObjectStoreProvider struct {
	root     string
	compress bool
	mu       sync.Mutex
}

// NewObjectStoreProvider creates an object-backed staging provider.
func NewObjectStoreProvider(root string) *ObjectStoreProvider {
	if root == "" {
		root = filepath.Join(os.TempDir(), "ucl-object-store")
	}
	_ = os.MkdirAll(root, 0o755)
	return &ObjectStoreProvider{
		root:     root,
		compress: true,
	}
}

func (p *ObjectStoreProvider) ID() string { return ProviderObjectStore }

func (p *ObjectStoreProvider) stageDir(stageID string, sliceID string) string {
	if sliceID == "" {
		sliceID = "slice"
	}
	return filepath.Join(p.root, stageID, sliceID)
}

func (p *ObjectStoreProvider) PutBatch(ctx context.Context, req *PutBatchRequest) (*PutBatchResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	stageID := resolveStageID(req.StageRef, req.StageID)
	if stageID == "" {
		stageID = NewStageID()
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	dir := p.stageDir(stageID, req.SliceID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create stage dir: %w", err)
	}

	batchSeq := req.BatchSeq
	if batchSeq <= 0 {
		if existing, err := p.listBatchesLocked(stageID, req.SliceID); err == nil {
			batchSeq = len(existing)
		}
	}
	batchFile := fmt.Sprintf("%06d.jsonl", batchSeq)
	if p.compress {
		batchFile += ".gz"
	}
	batchRef := filepath.Join(req.SliceID, batchFile)
	fullPath := filepath.Join(p.root, stageID, batchRef)

	buf := &bytes.Buffer{}
	if err := writeJSONLines(buf, req.Records, p.compress); err != nil {
		return nil, fmt.Errorf("encode batch: %w", err)
	}
	if err := os.WriteFile(fullPath, buf.Bytes(), 0o644); err != nil {
		return nil, fmt.Errorf("write batch: %w", err)
	}

	return &PutBatchResult{
		StageRef: MakeStageRef(p.ID(), stageID),
		BatchRef: batchRef,
		Stats: BatchStats{
			Records: len(req.Records),
			Bytes:   int64(buf.Len()),
		},
	}, nil
}

func (p *ObjectStoreProvider) listBatchesLocked(stageID string, sliceID string) ([]string, error) {
	stagePath := filepath.Join(p.root, stageID)
	if sliceID != "" {
		stagePath = filepath.Join(stagePath, sliceID)
	}

	var batches []string
	err := filepath.WalkDir(stagePath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(filepath.Join(p.root, stageID), path)
		if relErr != nil {
			return relErr
		}
		batches = append(batches, filepath.ToSlash(rel))
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	sort.Strings(batches)
	return batches, nil
}

func (p *ObjectStoreProvider) ListBatches(ctx context.Context, stageRef string, sliceID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := ParseStageRef(stageRef)

	p.mu.Lock()
	defer p.mu.Unlock()
	return p.listBatchesLocked(stageID, sliceID)
}

func (p *ObjectStoreProvider) GetBatch(ctx context.Context, stageRef string, batchRef string) ([]RecordEnvelope, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := ParseStageRef(stageRef)

	path := filepath.Join(p.root, stageID, filepath.FromSlash(batchRef))
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open batch: %w", err)
	}
	defer file.Close()

	var reader io.Reader = file
	if strings.HasSuffix(path, ".gz") {
		gz, gzErr := gzip.NewReader(file)
		if gzErr != nil {
			return nil, fmt.Errorf("gzip reader: %w", gzErr)
		}
		defer gz.Close()
		reader = gz
	}

	records, err := readJSONLines(reader)
	if err != nil {
		return nil, err
	}
	return records, nil
}

func (p *ObjectStoreProvider) FinalizeStage(ctx context.Context, stageRef string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	_, stageID := ParseStageRef(stageRef)
	// Keep artifacts for debugging; callers may clean up explicitly.
	_ = stageID
	return nil
}
