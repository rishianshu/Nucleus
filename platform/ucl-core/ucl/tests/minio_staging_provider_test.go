package tests

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/staging"
)

func TestMinioStagingProviderWritesBatches(t *testing.T) {
	root := t.TempDir()
	bucket := "staging-bucket"
	tenant := "tenant-staging"
	cfg := uclminio.ParseConfig(setupMinioConfig(t, root, bucket, tenant))

	provider, err := uclminio.NewStagingProvider(cfg, nil)
	if err != nil {
		t.Fatalf("failed to create staging provider: %v", err)
	}

	ctx := context.Background()
	totalRecords := 10000
	batchSize := 1200
	var stageRef string
	var batchRefs []string

	emitted := 0
	seq := 0
	for emitted < totalRecords {
		chunk := batchSize
		if remaining := totalRecords - emitted; remaining < chunk {
			chunk = remaining
		}

		records := make([]staging.RecordEnvelope, 0, chunk)
		for i := 0; i < chunk; i++ {
			records = append(records, staging.RecordEnvelope{
				RecordKind: "raw",
				EntityKind: "work.item",
				Source: staging.SourceRef{
					EndpointID:   "endpoint-minio",
					SourceFamily: "object.minio",
					SourceID:     "dataset",
				},
				Payload: map[string]any{
					"id":    fmt.Sprintf("rec-%d", emitted+i),
					"value": "payload",
				},
			})
		}

		res, err := provider.PutBatch(ctx, &staging.PutBatchRequest{
			StageRef: stageRef,
			SliceID:  "slice-1",
			BatchSeq: seq,
			Records:  records,
		})
		if err != nil {
			t.Fatalf("put batch failed: %v", err)
		}
		stageRef = res.StageRef
		batchRefs = append(batchRefs, res.BatchRef)
		emitted += chunk
		seq++
	}

	if stageRef == "" {
		t.Fatalf("expected stageRef to be set")
	}
	if len(batchRefs) == 0 {
		t.Fatalf("expected batchRefs to be recorded")
	}

	_, stageID := staging.ParseStageRef(stageRef)
	stageDir := filepath.Join(root, bucket, "staging", tenant, stageID)
	for _, ref := range batchRefs {
		path := filepath.Join(stageDir, filepath.FromSlash(ref))
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected batch file at %s: %v", path, err)
		}
	}

	readBack, err := provider.GetBatch(ctx, stageRef, batchRefs[0])
	if err != nil {
		t.Fatalf("failed to read batch back: %v", err)
	}
	if len(readBack) == 0 {
		t.Fatalf("expected records when reading back first batch")
	}
}
