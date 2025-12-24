package minio

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/nucleus/ucl-core/pkg/staging"
)

// StagingProvider writes staged JSONL.GZ batches into MinIO.
type StagingProvider struct {
	store       ObjectStore
	bucket      string
	tenantID    string
	stageRoot   string
	useCompress bool
}

// NewStagingProvider constructs a MinIO-backed staging provider.
// If store is nil, it will create an appropriate store based on config:
// - For http/https URLs: tries S3Client first
// - Falls back to LocalStore for file:// URLs or when S3Client fails
func NewStagingProvider(cfg *Config, store ObjectStore) (*StagingProvider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if cfg.Bucket == "" {
		return nil, wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket is required for staging"))
	}

	// If no store provided, try to create one based on config
	if store == nil {
		// Try S3Client for http/https endpoints
		if strings.HasPrefix(cfg.EndpointURL, "http://") || strings.HasPrefix(cfg.EndpointURL, "https://") {
			s3Client, err := NewS3Client(cfg)
			if err == nil {
				store = s3Client
			}
			// If S3Client creation failed, fall through to LocalStore
		}

		// Fallback to LocalStore
		if store == nil {
			store = NewLocalStore(cfg.objectRoot())
		}
	}

	if exists, err := store.BucketExists(context.Background(), cfg.Bucket); err != nil {
		return nil, err
	} else if !exists {
		// Auto-provision the bucket when it does not exist yet.
		if err := store.EnsureBucket(context.Background(), cfg.Bucket); err != nil {
			return nil, wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket %s not found: %w", cfg.Bucket, err))
		}
	}

	root := strings.TrimPrefix(cfg.TenantID, "/")
	if root == "" {
		root = defaultTenantID
	}

	return &StagingProvider{
		store:       store,
		bucket:      cfg.Bucket,
		tenantID:    root,
		stageRoot:   "staging",
		useCompress: true,
	}, nil
}

func (p *StagingProvider) ID() string {
	return staging.ProviderMinIO
}

func (p *StagingProvider) PutBatch(ctx context.Context, req *staging.PutBatchRequest) (*staging.PutBatchResult, error) {
	if req == nil {
		return nil, wrapError(CodeStagingWriteFailed, false, fmt.Errorf("request is required"))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	stageID := staging.MakeStageRef(p.ID(), staging.NewStageID())
	if req.StageRef != "" {
		stageID = req.StageRef
	}
	if req.StageID != "" {
		stageID = staging.MakeStageRef(p.ID(), req.StageID)
	}
	_, stageRefID := staging.ParseStageRef(stageID)
	if stageRefID == "" {
		stageRefID = staging.NewStageID()
		stageID = staging.MakeStageRef(p.ID(), stageRefID)
	}

	// Derive batch sequence (list existing if not provided).
	batchSeq := req.BatchSeq
	if batchSeq <= 0 {
		existing, err := p.ListBatches(ctx, stageID, req.SliceID)
		if err == nil {
			batchSeq = len(existing)
		}
	}

	buf := &bytes.Buffer{}
	if err := encodeEnvelopes(buf, req.Records, p.useCompress); err != nil {
		return nil, wrapError(CodeStagingWriteFailed, true, err)
	}

	batchFile := fmt.Sprintf("%06d.jsonl", batchSeq)
	if p.useCompress {
		batchFile += ".gz"
	}
	batchRef := joinPath(req.SliceID, batchFile)
	objectKey := joinPath(p.stageRoot, p.tenantID, stageRefID, batchRef)

	if err := p.store.PutObject(ctx, p.bucket, objectKey, buf.Bytes()); err != nil {
		return nil, err
	}

	return &staging.PutBatchResult{
		StageRef: stageID,
		BatchRef: batchRef,
		Stats: staging.BatchStats{
			Records: len(req.Records),
			Bytes:   int64(buf.Len()),
		},
	}, nil
}

func (p *StagingProvider) ListBatches(ctx context.Context, stageRef string, sliceID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := staging.ParseStageRef(stageRef)
	prefix := joinPath(p.stageRoot, p.tenantID, stageID)
	if sliceID != "" {
		prefix = joinPath(prefix, sliceID)
	}

	keys, err := p.store.ListPrefix(ctx, p.bucket, prefix)
	if err != nil {
		return nil, err
	}

	var batchRefs []string
	for _, key := range keys {
		trimmed := strings.TrimPrefix(key, joinPath(p.stageRoot, p.tenantID, stageID)+"/")
		if sliceID != "" && !strings.HasPrefix(trimmed, sliceID+"/") {
			continue
		}
		batchRefs = append(batchRefs, trimmed)
	}
	sort.Strings(batchRefs)
	return batchRefs, nil
}

func (p *StagingProvider) GetBatch(ctx context.Context, stageRef string, batchRef string) ([]staging.RecordEnvelope, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_, stageID := staging.ParseStageRef(stageRef)
	key := joinPath(p.stageRoot, p.tenantID, stageID, batchRef)

	data, err := p.store.GetObject(ctx, p.bucket, key)
	if err != nil {
		return nil, err
	}

	return decodeEnvelopes(bytes.NewReader(data))
}

func (p *StagingProvider) FinalizeStage(ctx context.Context, stageRef string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// Leave artifacts for debugging.
	_ = stageRef
	return nil
}

func encodeEnvelopes(w io.Writer, records []staging.RecordEnvelope, compress bool) error {
	var writer io.Writer = w
	var gz *gzip.Writer
	if compress {
		gz = gzip.NewWriter(w)
		writer = gz
		// No defer here - we close explicitly to capture errors
	}
	enc := json.NewEncoder(writer)
	for _, rec := range records {
		if err := enc.Encode(rec); err != nil {
			if gz != nil {
				_ = gz.Close() // Best-effort close on error
			}
			return err
		}
	}
	// Close gzip writer once and capture any flush errors
	if gz != nil {
		if err := gz.Close(); err != nil {
			return err
		}
	}
	return nil
}

func decodeEnvelopes(r io.Reader) ([]staging.RecordEnvelope, error) {
	var reader io.Reader = r
	if gz, err := gzip.NewReader(r); err == nil {
		defer gz.Close()
		reader = gz
	}
	dec := json.NewDecoder(reader)
	var records []staging.RecordEnvelope
	for dec.More() {
		var rec staging.RecordEnvelope
		if err := dec.Decode(&rec); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, nil
}
