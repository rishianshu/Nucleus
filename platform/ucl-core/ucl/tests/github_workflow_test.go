package tests

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	githubconnector "github.com/nucleus/ucl-core/internal/connector/github"
	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/staging"
)

func TestGitHubMetadataCollectionPublishesDatasets(t *testing.T) {
	stub := githubconnector.NewStubServer()
	defer stub.Close()

	ctx := context.Background()
	conn, err := githubconnector.New(map[string]any{
		"base_url":  stub.URL(),
		"token":     "stub-token",
		"tenant_id": "tenant-gh",
		"transport": stub.Transport(),
	})
	if err != nil {
		t.Fatalf("failed to create connector: %v", err)
	}

	datasets, err := conn.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets error: %v", err)
	}
	// 2 repos × 9 dataset types + 1 global api_surface = 19 datasets
	if len(datasets) != 19 {
		t.Fatalf("expected 19 datasets (2 repos × 9 types + api_surface), got %d", len(datasets))
	}
	// Find repo datasets specifically
	repoDatasets := 0
	for _, ds := range datasets {
		if strings.Contains(ds.ID, "catalog.dataset:code.repo:tenant-gh:") {
			repoDatasets++
			if ds.Metadata["projectKey"] == "" || ds.Metadata["defaultBranch"] == "" || ds.Metadata["htmlUrl"] == "" {
				t.Fatalf("expected repo metadata in dataset, got %+v", ds.Metadata)
			}
		}
	}
	if repoDatasets != 2 {
		t.Fatalf("expected 2 repo datasets, got %d", repoDatasets)
	}

	schema, err := conn.GetSchema(ctx, datasets[0].ID)
	if err != nil {
		t.Fatalf("GetSchema error: %v", err)
	}
	if len(schema.Fields) == 0 {
		t.Fatalf("expected schema fields for repo dataset")
	}
}

func TestGitHubPreviewSafety(t *testing.T) {
	stub := githubconnector.NewStubServer()
	defer stub.Close()

	ctx := context.Background()
	datasetID := "catalog.dataset:code.repo:tenant-gh:octo/alpha"
	conn, err := githubconnector.New(map[string]any{
		"base_url":  stub.URL(),
		"token":     "stub-token",
		"tenant_id": "tenant-gh",
		"transport": stub.Transport(),
	})
	if err != nil {
		t.Fatalf("failed to create connector: %v", err)
	}

	iter, err := conn.Read(ctx, &endpoint.ReadRequest{
		DatasetID: datasetID,
		Filter: map[string]any{
			"path": "README.md",
		},
	})
	if err != nil {
		t.Fatalf("preview read error: %v", err)
	}
	defer iter.Close()

	if !iter.Next() {
		t.Fatalf("expected preview record")
	}
	record := iter.Value()
	if _, ok := record["contentText"]; !ok {
		t.Fatalf("expected contentText in preview record")
	}

	_, err = conn.Read(ctx, &endpoint.ReadRequest{
		DatasetID: datasetID,
		Filter: map[string]any{
			"path": "bin/tool",
		},
	})
	if err == nil {
		t.Fatalf("expected preview error for binary file")
	}
	var coded interface{ CodeValue() string }
	if !errors.As(err, &coded) || coded.CodeValue() != "E_PREVIEW_UNSUPPORTED" {
		t.Fatalf("expected E_PREVIEW_UNSUPPORTED, got %v", err)
	}

	oversizeConn, err := githubconnector.New(map[string]any{
		"base_url":       stub.URL(),
		"token":          "stub-token",
		"tenant_id":      "tenant-gh",
		"max_file_bytes": 10,
		"transport":      stub.Transport(),
	})
	if err != nil {
		t.Fatalf("failed to create oversize connector: %v", err)
	}
	_, err = oversizeConn.Read(ctx, &endpoint.ReadRequest{
		DatasetID: datasetID,
		Filter: map[string]any{
			"path": "docs/big.txt",
		},
	})
	if err == nil {
		t.Fatalf("expected oversize preview error")
	}
	if !errors.As(err, &coded) || coded.CodeValue() != "E_PREVIEW_UNSUPPORTED" {
		t.Fatalf("expected E_PREVIEW_UNSUPPORTED for oversize file, got %v", err)
	}
}

func TestGitHubIngestionStagesAndSinks(t *testing.T) {
	stub := githubconnector.NewStubServer()
	defer stub.Close()

	ctx := context.Background()
	cfg := map[string]any{
		"base_url":      stub.URL(),
		"token":         "stub-token",
		"tenant_id":     "tenant-gh",
		"chunk_bytes":   64,
		"overlap_bytes": 8,
		"transport":     stub.Transport(),
	}
	conn, err := githubconnector.New(cfg)
	if err != nil {
		t.Fatalf("failed to create connector: %v", err)
	}

	datasetID := "catalog.dataset:code.repo:tenant-gh:octo/alpha"
	plan, err := conn.PlanIngestion(ctx, &endpoint.PlanIngestionRequest{
		DatasetID: datasetID,
		PageLimit: 50,
	})
	if err != nil {
		t.Fatalf("PlanIngestion error: %v", err)
	}
	if len(plan.Slices) == 0 {
		t.Fatalf("expected slices in ingestion plan")
	}

	root := t.TempDir()
	providerCfg := uclminio.ParseConfig(setupMinioConfig(t, root, "github-staging", "tenant-gh"))
	provider, err := uclminio.NewStagingProvider(providerCfg, nil)
	if err != nil {
		t.Fatalf("failed to create staging provider: %v", err)
	}

	stageRef := ""
	var batchRefs []string
	batchSeq := 0

	iter, err := conn.ReadSlice(ctx, &endpoint.SliceReadRequest{
		DatasetID: datasetID,
		Slice:     plan.Slices[0],
	})
	if err != nil {
		t.Fatalf("ReadSlice error: %v", err)
	}
	defer iter.Close()

	chunk := make([]staging.RecordEnvelope, 0, 32)
	flush := func() error {
		if len(chunk) == 0 {
			return nil
		}
		res, err := provider.PutBatch(ctx, &staging.PutBatchRequest{
			StageRef: stageRef,
			SliceID:  plan.Slices[0].SliceID,
			BatchSeq: batchSeq,
			Records:  chunk,
		})
		if err != nil {
			return err
		}
		stageRef = res.StageRef
		batchRefs = append(batchRefs, res.BatchRef)
		batchSeq++
		chunk = chunk[:0]
		return nil
	}

	for iter.Next() {
		record := iter.Value()
		env := buildEnvelope(record, datasetID, "http.github", "endpoint-gh")
		chunk = append(chunk, env)
		if len(chunk) >= cap(chunk) {
			if err := flush(); err != nil {
				t.Fatalf("failed to flush staging batch: %v", err)
			}
		}
	}
	if err := iter.Err(); err != nil {
		t.Fatalf("iterator error: %v", err)
	}
	if err := flush(); err != nil {
		t.Fatalf("failed to flush final batch: %v", err)
	}
	if stageRef == "" {
		t.Fatalf("expected stageRef to be set")
	}

	sink, err := uclminio.New(setupMinioConfig(t, root, "github-staging", "tenant-gh"))
	if err != nil {
		t.Fatalf("failed to create sink endpoint: %v", err)
	}
	loadDate := time.Now().Format("2006-01-02")
	sinkResult, err := sink.WriteFromStage(ctx, provider, stageRef, batchRefs, "sink-gh", "run-gh", loadDate)
	if err != nil {
		t.Fatalf("sink write failed: %v", err)
	}
	if sinkResult.Artifacts["raw.code.file"] == "" || sinkResult.Artifacts["raw.code.file_chunk"] == "" {
		t.Fatalf("expected sink artifacts for file and chunk, got %+v", sinkResult.Artifacts)
	}
	if sinkResult.Records == 0 {
		t.Fatalf("expected records to be written")
	}

	for _, objURL := range sinkResult.Objects {
		path := objectURLToPath(root, objURL)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected staged object at %s: %v", path, err)
		}
	}
}

func buildEnvelope(record endpoint.Record, datasetID, templateID, endpointID string) staging.RecordEnvelope {
	entityKind := datasetID
	tenantID := ""
	projectKey := ""
	sourceURL := ""
	externalID := ""

	payload := make(map[string]any, len(record))
	for k, v := range record {
		switch strings.ToLower(k) {
		case "_entity", "_entitykind", "__entity":
			if s, ok := v.(string); ok && s != "" {
				entityKind = s
			}
		case "_tenantid", "tenantid":
			tenantID = fmt.Sprint(v)
		case "_projectkey", "projectkey":
			projectKey = fmt.Sprint(v)
		case "_sourceurl", "sourceurl":
			sourceURL = fmt.Sprint(v)
		case "_externalid", "externalid":
			externalID = fmt.Sprint(v)
		default:
			payload[k] = v
		}
	}

	return staging.RecordEnvelope{
		RecordKind: "raw",
		EntityKind: entityKind,
		Source: staging.SourceRef{
			EndpointID:   endpointID,
			SourceFamily: templateID,
			SourceID:     datasetID,
			URL:          sourceURL,
			ExternalID:   externalID,
		},
		TenantID:   tenantID,
		ProjectKey: projectKey,
		Payload:    payload,
		ObservedAt: time.Now().UTC().Format(time.RFC3339),
	}
}
