package minio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
	"github.com/nucleus/ucl-core/pkg/staging"
	writerfile "github.com/xitongsys/parquet-go-source/writerfile"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/writer"
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
	// Prefer Parquet when schema is provided; fallback to JSONL.GZ.
	if req.Schema != nil && len(req.Schema.Fields) > 0 {
		path, rows, err := e.writeParquet(ctx, sinkID, loadDate, runID, req)
		if err == nil {
			artifacts[sinkID] = fmt.Sprintf("minio://%s/%s", e.config.Bucket, joinPath(e.config.BasePrefix, e.config.TenantID, sinkID))
			return &endpoint.WriteResult{RowsWritten: rows, Path: path}, nil
		}
		// Fallback to JSONL on error.
	}

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

// Provision ensures the sink destination is available. For MinIO, verify bucket exists.
func (e *Endpoint) Provision(ctx context.Context, datasetID string, schema *endpoint.Schema) error {
	_ = datasetID
	_ = schema
	exists, err := e.store.BucketExists(ctx, e.config.Bucket)
	if err != nil {
		return err
	}
	if !exists {
		return wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket %s not found", e.config.Bucket))
	}
	return nil
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

// writeParquet writes all records in a single Parquet file using the provided schema.
func (e *Endpoint) writeParquet(ctx context.Context, sinkID, loadDate, runID string, req *endpoint.WriteRequest) (string, int64, error) {
	buf := &bytes.Buffer{}
	pfw := writerfile.NewWriterFile(buf)
	schemaDef := buildParquetSchema(req.Schema)
	pw, err := writer.NewJSONWriter(schemaDef, pfw, 4)
	if err != nil {
		return "", 0, wrapError(CodeSinkWriteFailed, true, err)
	}
	pw.CompressionType = parquet.CompressionCodec_SNAPPY

	var rows int64
	for _, rec := range req.Records {
		row := projectParquetRow(rec, req.Schema)
		if err := pw.Write(row); err != nil {
			_ = pw.WriteStop()
			_ = pfw.Close()
			return "", rows, wrapError(CodeSinkWriteFailed, true, err)
		}
		rows++
	}
	if err := pw.WriteStop(); err != nil {
		_ = pfw.Close()
		return "", rows, wrapError(CodeSinkWriteFailed, true, err)
	}
	_ = pfw.Close()

	key := joinPath(
		e.config.BasePrefix,
		e.config.TenantID,
		sinkID,
		fmt.Sprintf("dt=%s", loadDate),
		fmt.Sprintf("run=%s", runID),
		fmt.Sprintf("part-%06d.parquet", 0),
	)
	if err := e.store.PutObject(ctx, e.config.Bucket, key, buf.Bytes()); err != nil {
		return "", rows, err
	}
	return fmt.Sprintf("minio://%s/%s", e.config.Bucket, key), rows, nil
}

func buildParquetSchema(schema *endpoint.Schema) string {
	fields := make([]map[string]string, 0, len(schema.Fields))
	for _, f := range schema.Fields {
		fieldType := parquetPhysicalType(f.DataType)
		fields = append(fields, map[string]string{
			"Tag": fmt.Sprintf("name=%s, type=%s, repetitiontype=OPTIONAL", f.Name, fieldType),
		})
	}
	out := map[string]any{
		"Tag":    "name=parquet_go_root, repetitiontype=REQUIRED",
		"Fields": fields,
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func parquetPhysicalType(dataType string) string {
	switch strings.ToUpper(dataType) {
	case "BOOLEAN":
		return "BOOLEAN"
	case "INTEGER", "INT", "BIGINT":
		return "INT64"
	case "FLOAT", "DOUBLE", "NUMBER", "NUMERIC", "DECIMAL":
		return "DOUBLE"
	default:
		return "BYTE_ARRAY"
	}
}

func projectParquetRow(rec endpoint.Record, schema *endpoint.Schema) map[string]any {
	row := make(map[string]any, len(schema.Fields))
	payload, _ := rec["payload"].(map[string]any)
	for _, f := range schema.Fields {
		var val any
		if payload != nil {
			val = payload[f.Name]
		}
		row[f.Name] = val
	}
	return row
}
