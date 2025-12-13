//go:build integration

package tests

import (
	"context"
	"testing"

	github "github.com/nucleus/ucl-core/internal/connector/github"
	"github.com/nucleus/ucl-core/pkg/endpoint"
)

// TestGitHubRealAPIPublicRepo tests against the real GitHub API with a public repo.
// Run with: go test -tags integration -run TestGitHubRealAPIPublicRepo ./ucl/tests/... -v
func TestGitHubRealAPIPublicRepo(t *testing.T) {
	cfg := map[string]any{
		"base_url":  "https://api.github.com",
		"token":     "", // Empty token - unauthenticated public access
		"tenant_id": "test-tenant",
		"repos":     "octocat/Hello-World",
	}

	ctx := context.Background()
	conn, err := github.New(cfg)
	if err != nil {
		t.Fatalf("Failed to create connector: %v", err)
	}

	// Test 1: ValidateConfig (ping)
	t.Run("ValidateConfig", func(t *testing.T) {
		result, err := conn.ValidateConfig(ctx, cfg)
		if err != nil {
			t.Logf("ValidateConfig failed (expected without token): %v", err)
			// Skip remaining tests if we can't authenticate
			return
		}
		t.Logf("ValidateConfig: valid=%v, message=%s", result.Valid, result.Message)
	})

	// Test 2: ListDatasets (metadata)
	t.Run("ListDatasets", func(t *testing.T) {
		datasets, err := conn.ListDatasets(ctx)
		if err != nil {
			t.Fatalf("ListDatasets error: %v", err)
		}
		t.Logf("Found %d datasets", len(datasets))
		if len(datasets) == 0 {
			t.Fatal("Expected at least one dataset")
		}
		for _, ds := range datasets {
			t.Logf("  Dataset: %s", ds.ID)
			t.Logf("    projectKey: %s", ds.Metadata["projectKey"])
			t.Logf("    defaultBranch: %s", ds.Metadata["defaultBranch"])
		}
	})

	// Test 3: ProbeIngestion
	t.Run("ProbeIngestion", func(t *testing.T) {
		datasets, _ := conn.ListDatasets(ctx)
		if len(datasets) == 0 {
			t.Skip("No datasets to probe")
		}
		probe, err := conn.ProbeIngestion(ctx, &endpoint.ProbeRequest{DatasetID: datasets[0].ID})
		if err != nil {
			t.Fatalf("ProbeIngestion error: %v", err)
		}
		t.Logf("Estimated files: %d", probe.EstimatedCount)
		t.Logf("Repos: %v", probe.SliceKeys)
	})

	// Test 4: Preview file (README)
	t.Run("PreviewREADME", func(t *testing.T) {
		datasets, _ := conn.ListDatasets(ctx)
		if len(datasets) == 0 {
			t.Skip("No datasets to preview")
		}
		iter, err := conn.Read(ctx, &endpoint.ReadRequest{
			DatasetID: datasets[0].ID,
			Filter: map[string]any{
				"path": "README",
			},
		})
		if err != nil {
			t.Fatalf("Preview error: %v", err)
		}
		defer iter.Close()
		if iter.Next() {
			record := iter.Value()
			if content, ok := record["contentText"].(string); ok {
				preview := content
				if len(preview) > 300 {
					preview = preview[:300] + "..."
				}
				t.Logf("README preview:\n%s", preview)
			}
		}
	})
}
