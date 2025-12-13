package tests

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
)

func TestMinioNegativeCases(t *testing.T) {
	root := t.TempDir()

	// Unreachable endpointUrl should surface E_ENDPOINT_UNREACHABLE and be retryable.
	params := setupMinioConfig(t, root, "neg-bucket", "tenant-neg")
	params["endpointUrl"] = "http://unreachable.example"
	ep, err := uclminio.New(params)
	if err != nil {
		t.Fatalf("failed to create minio endpoint: %v", err)
	}
	res, err := ep.ValidateConfig(context.Background(), params)
	if err != nil {
		t.Fatalf("validate config returned error: %v", err)
	}
	if res.Valid {
		t.Fatalf("expected validation failure for unreachable endpoint")
	}
	if res.Code != uclminio.CodeEndpointUnreachable {
		t.Fatalf("expected code %s, got %s", uclminio.CodeEndpointUnreachable, res.Code)
	}
	if !res.Retryable {
		t.Fatalf("expected unreachable endpoint to be retryable")
	}

	// Missing bucket when constructing staging provider should fail fast.
	rootMissing := filepath.Join(root, "missing")
	cfg := uclminio.ParseConfig(map[string]any{
		"endpointUrl":     "",
		"accessKeyId":     "minioadmin",
		"secretAccessKey": "minioadmin",
		"bucket":          "bucket-not-present",
		"rootPath":        rootMissing,
	})
	provider, provErr := uclminio.NewStagingProvider(cfg, nil)
	if provErr == nil {
		providerID := ""
		if provider != nil {
			providerID = provider.ID()
		}
		t.Fatalf("expected staging provider creation to fail, provider=%s", providerID)
	}
	var coded interface {
		CodeValue() string
		RetryableStatus() bool
	}
	if !errors.As(provErr, &coded) {
		t.Fatalf("expected coded error, got %v", provErr)
	}
	if coded.CodeValue() != uclminio.CodeBucketNotFound {
		t.Fatalf("expected %s, got %s", uclminio.CodeBucketNotFound, coded.CodeValue())
	}
	if coded.RetryableStatus() {
		t.Fatalf("bucket-not-found should not be retryable")
	}
}
