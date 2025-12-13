package minio

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
	"github.com/nucleus/ucl-core/pkg/staging"
)

// SinkResult captures sink write outcomes.
type SinkResult struct {
	Objects      []string
	Artifacts    map[string]string
	Records      int64
	BytesWritten int64
}

// WriteRaw satisfies endpoint.SinkEndpoint but primarily supports stageRef-driven writes via WriteFromStage.
func (e *Endpoint) WriteRaw(ctx context.Context, req *endpoint.WriteRequest) (*endpoint.WriteResult, error) {
	if req == nil {
		return nil, wrapError(CodeSinkWriteFailed, true, fmt.Errorf("request is required"))
	}
	if len(req.Records) == 0 {
		return &endpoint.WriteResult{RowsWritten: 0, Path: ""}, nil
	}

	loadDate := req.LoadDate
	if loadDate == "" {
		loadDate = time.Now().UTC().Format("2006-01-02")
	}
	sinkID := req.DatasetID
	if sinkID == "" {
		sinkID = "dataset"
	}

	// Generate a run ID if not provided via Mode field (repurposed for run tracking)
	runID := req.Mode
	if runID == "" {
		runID = fmt.Sprintf("run-%d", time.Now().UnixNano())
	}

	artifacts := map[string]string{}
	var objects []string
	var rows int64
	var bytesWritten int64
	seq := 0

	for _, rec := range req.Records {
		envelope := staging.RecordEnvelope{
			RecordKind: "raw",
			EntityKind: sinkID,
			Payload:    rec,
		}
		buf := &bytes.Buffer{}
		if err := encodeEnvelopes(buf, []staging.RecordEnvelope{envelope}, true); err != nil {
			return nil, wrapError(CodeSinkWriteFailed, true, err)
		}
		// FIX: Use resolved loadDate and runID instead of raw req.LoadDate
		key := joinPath(e.config.BasePrefix, e.config.TenantID, sinkID, fmt.Sprintf("dt=%s", loadDate), fmt.Sprintf("run=%s", runID), fmt.Sprintf("part-%06d.jsonl.gz", seq))
		if err := e.store.PutObject(ctx, e.config.Bucket, key, buf.Bytes()); err != nil {
			return nil, err
		}
		objects = append(objects, fmt.Sprintf("minio://%s/%s", e.config.Bucket, key))
		artifacts[sinkID] = fmt.Sprintf("minio://%s/%s", e.config.Bucket, joinPath(e.config.BasePrefix, e.config.TenantID, sinkID))
		rows++
		bytesWritten += int64(buf.Len())
		seq++
	}

	return &endpoint.WriteResult{
		RowsWritten: rows,
		Path:        strings.Join(objects, ","),
	}, nil
}

// WriteFromStage consumes staged batches and writes sink artifacts.
func (e *Endpoint) WriteFromStage(ctx context.Context, provider staging.Provider, stageRef string, batchRefs []string, sinkID string, runID string, loadDate string) (*SinkResult, error) {
	if provider == nil {
		return nil, wrapError(CodeSinkWriteFailed, true, fmt.Errorf("staging provider required"))
	}
	if stageRef == "" {
		return nil, wrapError(CodeSinkWriteFailed, true, fmt.Errorf("stageRef is required"))
	}
	if len(batchRefs) == 0 {
		return &SinkResult{Objects: []string{}, Artifacts: map[string]string{}}, nil
	}
	if sinkID == "" {
		sinkID = "sink-endpoint"
	}
	if runID == "" {
		_, runID = staging.ParseStageRef(stageRef)
	}
	if loadDate == "" {
		loadDate = time.Now().UTC().Format("2006-01-02")
	}

	exists, err := e.store.BucketExists(ctx, e.config.Bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket %s not found", e.config.Bucket))
	}

	var objects []string
	artifactPaths := map[string]string{}
	var totalRecords int64
	var totalBytes int64
	partSeq := 0

	for _, batchRef := range batchRefs {
		records, getErr := provider.GetBatch(ctx, stageRef, batchRef)
		if getErr != nil {
			return nil, getErr
		}
		if len(records) == 0 {
			continue
		}

		bySlug := make(map[string][]staging.RecordEnvelope)
		for _, rec := range records {
			slug := slugFromEnvelope(rec)
			bySlug[slug] = append(bySlug[slug], rec)
		}

		var slugs []string
		for slug := range bySlug {
			slugs = append(slugs, slug)
		}
		sort.Strings(slugs)

		for _, slug := range slugs {
			recs := bySlug[slug]
			buf := &bytes.Buffer{}
			if err := encodeEnvelopes(buf, recs, true); err != nil {
				return nil, wrapError(CodeSinkWriteFailed, true, err)
			}

			key := joinPath(
				e.config.BasePrefix,
				e.config.TenantID,
				sinkID,
				slug,
				fmt.Sprintf("dt=%s", loadDate),
				fmt.Sprintf("run=%s", runID),
				fmt.Sprintf("part-%06d.jsonl.gz", partSeq),
			)
			if err := e.store.PutObject(ctx, e.config.Bucket, key, buf.Bytes()); err != nil {
				return nil, err
			}

			objURL := fmt.Sprintf("minio://%s/%s", e.config.Bucket, key)
			objects = append(objects, objURL)
			artifactPaths[slug] = fmt.Sprintf("minio://%s/%s", e.config.Bucket, joinPath(e.config.BasePrefix, e.config.TenantID, sinkID, slug))
			totalRecords += int64(len(recs))
			totalBytes += int64(buf.Len())
			partSeq++
		}
	}

	return &SinkResult{
		Objects:      objects,
		Artifacts:    artifactPaths,
		Records:      totalRecords,
		BytesWritten: totalBytes,
	}, nil
}

func (e *Endpoint) Finalize(ctx context.Context, datasetID string, loadDate string) (*endpoint.FinalizeResult, error) {
	return &endpoint.FinalizeResult{FinalPath: joinPath(e.config.BasePrefix, datasetID, loadDate)}, nil
}

func (e *Endpoint) GetLatestWatermark(ctx context.Context, datasetID string) (string, error) {
	_ = ctx
	_ = datasetID
	return "", nil
}

func slugFromEnvelope(rec staging.RecordEnvelope) string {
	recordKind := rec.RecordKind
	if recordKind == "" {
		recordKind = "raw"
	}
	entity := rec.EntityKind
	if entity == "" {
		entity = "dataset"
	}
	entity = strings.ReplaceAll(entity, "/", ".")
	return fmt.Sprintf("%s.%s", recordKind, entity)
}
