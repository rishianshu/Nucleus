//go:build integration
// +build integration

package tests

import (
	"context"
	"os"
	"testing"

	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/staging"
)

// TestMinioRealS3Integration tests real MinIO connectivity.
// Run with: go test -tags integration -run TestMinioRealS3Integration ./ucl/tests/...
func TestMinioRealS3Integration(t *testing.T) {
	// Skip if MINIO_TEST_ENDPOINT is not set
	endpoint := os.Getenv("MINIO_TEST_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:9000"
	}
	accessKey := os.Getenv("MINIO_TEST_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minioadmin"
	}
	secretKey := os.Getenv("MINIO_TEST_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minioadmin"
	}
	bucket := os.Getenv("MINIO_TEST_BUCKET")
	if bucket == "" {
		bucket = "ucl-staging"
	}

	cfg := map[string]any{
		"endpointUrl":     endpoint,
		"accessKeyId":     accessKey,
		"secretAccessKey": secretKey,
		"bucket":          bucket,
		"tenantId":        "integration-test",
		// NO rootPath - this forces real S3Client usage
	}

	t.Run("ValidateConfig", func(t *testing.T) {
		ep, err := uclminio.New(cfg)
		if err != nil {
			t.Fatalf("failed to create endpoint: %v", err)
		}
		ctx := context.Background()
		result, err := ep.ValidateConfig(ctx, cfg)
		if err != nil {
			t.Fatalf("ValidateConfig error: %v", err)
		}
		if !result.Valid {
			t.Fatalf("ValidateConfig failed: %s (code=%s)", result.Message, result.Code)
		}
		t.Logf("ValidateConfig passed: %s", result.Message)
	})

	t.Run("StagingProviderPutAndGet", func(t *testing.T) {
		parsedCfg := uclminio.ParseConfig(cfg)
		provider, err := uclminio.NewStagingProvider(parsedCfg, nil)
		if err != nil {
			t.Fatalf("failed to create staging provider: %v", err)
		}

		ctx := context.Background()
		records := []staging.RecordEnvelope{
			{RecordKind: "raw", EntityKind: "test.item", Payload: map[string]any{"id": "1", "name": "test"}},
			{RecordKind: "raw", EntityKind: "test.item", Payload: map[string]any{"id": "2", "name": "test2"}},
		}

		result, err := provider.PutBatch(ctx, &staging.PutBatchRequest{
			SliceID:  "slice-integration",
			BatchSeq: 0,
			Records:  records,
		})
		if err != nil {
			t.Fatalf("PutBatch failed: %v", err)
		}

		t.Logf("Staged to: stageRef=%s, batchRef=%s, bytes=%d", result.StageRef, result.BatchRef, result.Stats.Bytes)

		// Read back
		fetched, err := provider.GetBatch(ctx, result.StageRef, result.BatchRef)
		if err != nil {
			t.Fatalf("GetBatch failed: %v", err)
		}

		if len(fetched) != len(records) {
			t.Fatalf("expected %d records, got %d", len(records), len(fetched))
		}
		t.Logf("Retrieved %d records successfully from MinIO", len(fetched))
	})
}
