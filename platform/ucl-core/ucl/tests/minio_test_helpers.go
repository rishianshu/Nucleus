package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupMinioConfig(t *testing.T, root string, bucket string, tenant string) map[string]any {
	t.Helper()
	if bucket == "" {
		bucket = "ucl-staging"
	}
	if tenant == "" {
		tenant = "tenant-default"
	}
	mustMkdirAll(t, filepath.Join(root, bucket))
	return map[string]any{
		// Use file:// URL to force LocalStore (not S3Client) for unit tests
		"endpointUrl":     "file://" + root,
		"accessKeyId":     "minioadmin",
		"secretAccessKey": "minioadmin",
		"bucket":          bucket,
		"rootPath":        root,
		"tenantId":        tenant,
	}
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("failed to create dir %s: %v", path, err)
	}
}

func objectURLToPath(root string, objectURL string) string {
	trimmed := strings.TrimPrefix(objectURL, "minio://")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return filepath.Join(root, trimmed)
	}
	return filepath.Join(root, parts[0], filepath.FromSlash(parts[1]))
}
