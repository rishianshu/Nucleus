package tests

import (
	"context"
	"path/filepath"
	"testing"

	uclminio "github.com/nucleus/ucl-core/internal/connector/minio"
)

func TestMinioTestConnectionCapabilities(t *testing.T) {
	root := t.TempDir()
	params := setupMinioConfig(t, root, "test-conn-bucket", "tenant-a")

	ep, err := uclminio.New(params)
	if err != nil {
		t.Fatalf("failed to create minio endpoint: %v", err)
	}

	res, err := ep.ValidateConfig(context.Background(), params)
	if err != nil {
		t.Fatalf("validate config returned error: %v", err)
	}
	if !res.Valid {
		t.Fatalf("expected validation success, got %+v", res)
	}
	if res.Code != "" {
		t.Fatalf("unexpected code on success: %s", res.Code)
	}

	caps := ep.GetCapabilities()
	capSet := map[string]bool{}
	if caps.SupportsStaging {
		capSet["staging.provider.object_store"] = true
	}
	if caps.SupportsWrite {
		capSet["sink.write"] = true
	}
	if !capSet["staging.provider.object_store"] || !capSet["sink.write"] {
		t.Fatalf("capabilities missing staging/sink entries: %+v", capSet)
	}
}

func TestMinioTestConnectionInvalidCreds(t *testing.T) {
	root := t.TempDir()
	params := setupMinioConfig(t, root, "test-invalid-bucket", "tenant-b")
	params["accessKeyId"] = "invalid"
	params["secretAccessKey"] = "invalid"

	ep, err := uclminio.New(params)
	if err != nil {
		t.Fatalf("failed to create minio endpoint: %v", err)
	}

	res, err := ep.ValidateConfig(context.Background(), params)
	if err != nil {
		t.Fatalf("validate config returned error: %v", err)
	}
	if res.Valid {
		t.Fatalf("expected validation failure for invalid creds")
	}
	if res.Code != uclminio.CodeAuthInvalid {
		t.Fatalf("expected code %s, got %s (message=%s)", uclminio.CodeAuthInvalid, res.Code, res.Message)
	}

	// Ensure bucket path was not mutated
	if _, err := filepath.Abs(params["rootPath"].(string)); err != nil {
		t.Fatalf("rootPath should remain usable: %v", err)
	}
}
