package hdfs

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// UNIT TESTS
// =============================================================================

func TestHDFS_FactoryRegistration(t *testing.T) {
	registry := endpoint.DefaultRegistry()
	factories := registry.List()

	found := false
	for _, f := range factories {
		if f == "hdfs.webhdfs" {
			found = true
			break
		}
	}

	if !found {
		t.Error("hdfs.webhdfs factory not registered")
	}
}

func TestHDFS_DatasetDefinitions(t *testing.T) {
	if len(DatasetDefinitions) != 2 {
		t.Errorf("Expected 2 datasets, got %d", len(DatasetDefinitions))
	}

	expectedIDs := []string{"hdfs.file", "hdfs.directory"}
	for i, id := range expectedIDs {
		if DatasetDefinitions[i].ID != id {
			t.Errorf("Expected dataset %s, got %s", id, DatasetDefinitions[i].ID)
		}
	}
}

func TestHDFS_ParseConfig(t *testing.T) {
	tests := []struct {
		name    string
		config  map[string]any
		wantErr bool
	}{
		{
			name: "valid config",
			config: map[string]any{
				"namenodeUrl": "http://localhost:9870",
				"user":        "testuser",
			},
			wantErr: false,
		},
		{
			name:    "missing namenode",
			config:  map[string]any{},
			wantErr: true,
		},
		{
			name: "snake_case config",
			config: map[string]any{
				"namenode_url": "http://localhost:9870",
				"base_path":    "/data",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := ParseConfig(tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseConfig() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && cfg == nil {
				t.Error("Expected config, got nil")
			}
		})
	}
}

func TestHDFS_GetDatasetByID(t *testing.T) {
	ds := GetDatasetByID("hdfs.file")
	if ds == nil {
		t.Fatal("Expected hdfs.file dataset")
	}
	if ds.ID != "hdfs.file" {
		t.Errorf("Expected hdfs.file, got %s", ds.ID)
	}

	ds = GetDatasetByID("nonexistent")
	if ds != nil {
		t.Error("Expected nil for nonexistent dataset")
	}
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

func skipIfNoHDFS(t *testing.T) {
	if os.Getenv("HDFS_NAMENODE_URL") == "" {
		t.Skip("HDFS_NAMENODE_URL not set")
	}
}

func getHDFSConfig() map[string]any {
	return map[string]any{
		"namenodeUrl": os.Getenv("HDFS_NAMENODE_URL"),
		"user":        os.Getenv("HDFS_USER"),
		"basePath":    os.Getenv("HDFS_BASE_PATH"),
	}
}

func TestHDFS_Integration_ValidateConfig(t *testing.T) {
	skipIfNoHDFS(t)

	registry := endpoint.DefaultRegistry()
	config := getHDFSConfig()

	ep, err := registry.Create("hdfs.webhdfs", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	result, err := ep.ValidateConfig(ctx, config)
	if err != nil {
		t.Fatalf("ValidateConfig error: %v", err)
	}

	if !result.Valid {
		t.Errorf("Expected valid config: %s", result.Message)
	}
	t.Logf("✅ %s", result.Message)
}

func TestHDFS_Integration_ListDatasets(t *testing.T) {
	skipIfNoHDFS(t)

	registry := endpoint.DefaultRegistry()
	config := getHDFSConfig()

	ep, err := registry.Create("hdfs.webhdfs", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	sourceEp := ep.(endpoint.SourceEndpoint)

	datasets, err := sourceEp.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets error: %v", err)
	}

	if len(datasets) != 2 {
		t.Errorf("Expected 2 datasets, got %d", len(datasets))
	}

	for _, ds := range datasets {
		t.Logf("  Dataset: %s - %s", ds.ID, ds.Name)
	}
}

func TestHDFS_Integration_ReadFiles(t *testing.T) {
	skipIfNoHDFS(t)

	registry := endpoint.DefaultRegistry()
	config := getHDFSConfig()

	ep, err := registry.Create("hdfs.webhdfs", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	sourceEp := ep.(endpoint.SourceEndpoint)

	iter, err := sourceEp.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "hdfs.file",
	})
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	defer iter.Close()

	count := 0
	for iter.Next() {
		record := iter.Value()
		if count < 5 {
			t.Logf("  File: %s (%d bytes)", record["path"], record["size"])
		}
		count++
	}

	if err := iter.Err(); err != nil {
		t.Errorf("Iterator error: %v", err)
	}

	t.Logf("✅ Read %d files", count)
}

func TestHDFS_Integration_Capabilities(t *testing.T) {
	skipIfNoHDFS(t)

	registry := endpoint.DefaultRegistry()
	config := getHDFSConfig()

	ep, err := registry.Create("hdfs.webhdfs", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	caps := ep.GetCapabilities()
	if !caps.SupportsFull {
		t.Error("Expected SupportsFull capability")
	}
	if !caps.SupportsPreview {
		t.Error("Expected SupportsPreview capability")
	}

	t.Logf("✅ Capabilities: SupportsFull=%v, SupportsPreview=%v",
		caps.SupportsFull, caps.SupportsPreview)
}
