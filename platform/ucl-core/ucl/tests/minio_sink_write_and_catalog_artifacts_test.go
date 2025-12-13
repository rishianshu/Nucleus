package tests

import (
	"context"
	"os"
	"testing"

	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/staging"
)

func TestMinioSinkWritesArtifactsFromStage(t *testing.T) {
	root := t.TempDir()
	bucket := "sink-bucket"
	tenant := "tenant-sink"
	cfg := uclminio.ParseConfig(setupMinioConfig(t, root, bucket, tenant))

	provider, err := uclminio.NewStagingProvider(cfg, nil)
	if err != nil {
		t.Fatalf("failed to create staging provider: %v", err)
	}

	ctx := context.Background()
	stageRef := ""
	var batchRefs []string

	recordsA := []staging.RecordEnvelope{
		{RecordKind: "raw", EntityKind: "work.item", Payload: map[string]any{"id": "1"}},
		{RecordKind: "raw", EntityKind: "work.item", Payload: map[string]any{"id": "2"}},
	}
	resA, err := provider.PutBatch(ctx, &staging.PutBatchRequest{StageRef: stageRef, SliceID: "slice-a", BatchSeq: 0, Records: recordsA})
	if err != nil {
		t.Fatalf("failed to put batch A: %v", err)
	}
	stageRef = resA.StageRef
	batchRefs = append(batchRefs, resA.BatchRef)

	recordsB := []staging.RecordEnvelope{
		{RecordKind: "raw", EntityKind: "doc.item", Payload: map[string]any{"id": "doc-1"}},
	}
	resB, err := provider.PutBatch(ctx, &staging.PutBatchRequest{StageRef: stageRef, SliceID: "slice-b", BatchSeq: 1, Records: recordsB})
	if err != nil {
		t.Fatalf("failed to put batch B: %v", err)
	}
	batchRefs = append(batchRefs, resB.BatchRef)

	sinkEndpoint, err := uclminio.New(setupMinioConfig(t, root, bucket, tenant))
	if err != nil {
		t.Fatalf("failed to create sink endpoint: %v", err)
	}

	sinkResult, err := sinkEndpoint.WriteFromStage(ctx, provider, stageRef, batchRefs, "sink-123", "run-001", "2025-12-13")
	if err != nil {
		t.Fatalf("sink write failed: %v", err)
	}

	if len(sinkResult.Objects) == 0 {
		t.Fatalf("expected sink objects to be written")
	}
	if sinkResult.Records != int64(len(recordsA)+len(recordsB)) {
		t.Fatalf("records count mismatch: got %d", sinkResult.Records)
	}
	if sinkResult.BytesWritten == 0 {
		t.Fatalf("expected bytes written to be recorded")
	}

	for _, objURL := range sinkResult.Objects {
		path := objectURLToPath(root, objURL)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected object file at %s: %v", path, err)
		}
	}

	if sinkResult.Artifacts["raw.work.item"] == "" {
		t.Fatalf("expected artifact entry for raw.work.item")
	}
	if sinkResult.Artifacts["raw.doc.item"] == "" {
		t.Fatalf("expected artifact entry for raw.doc.item")
	}
}
