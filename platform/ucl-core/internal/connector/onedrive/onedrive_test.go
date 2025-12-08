package onedrive

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// UNIT TESTS
// =============================================================================

func TestOneDrive_FactoryRegistration(t *testing.T) {
	registry := endpoint.DefaultRegistry()
	factories := registry.List()

	found := false
	for _, f := range factories {
		if f == "cloud.onedrive" {
			found = true
			break
		}
	}

	if !found {
		t.Error("cloud.onedrive factory not registered")
	}
}

func TestOneDrive_DatasetDefinitions(t *testing.T) {
	if len(DatasetDefinitions) != 2 {
		t.Errorf("Expected 2 datasets, got %d", len(DatasetDefinitions))
	}

	expectedIDs := []string{"onedrive.file", "onedrive.folder"}
	for i, id := range expectedIDs {
		if DatasetDefinitions[i].ID != id {
			t.Errorf("Expected dataset %s, got %s", id, DatasetDefinitions[i].ID)
		}
	}
}

func TestOneDrive_ParseConfig(t *testing.T) {
	tests := []struct {
		name    string
		config  map[string]any
		wantErr bool
	}{
		{
			name: "valid config with refresh token",
			config: map[string]any{
				"clientId":     "test-client-id",
				"refreshToken": "test-refresh-token",
			},
			wantErr: false,
		},
		{
			name: "valid config with client secret",
			config: map[string]any{
				"clientId":     "test-client-id",
				"clientSecret": "test-secret",
			},
			wantErr: false,
		},
		{
			name:    "missing clientId",
			config:  map[string]any{},
			wantErr: true,
		},
		{
			name: "missing auth credentials",
			config: map[string]any{
				"clientId": "test-client-id",
			},
			wantErr: true,
		},
		{
			name: "snake_case config",
			config: map[string]any{
				"client_id":     "test-client-id",
				"refresh_token": "test-refresh-token",
				"tenant_id":     "test-tenant",
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

func TestOneDrive_GetDatasetByID(t *testing.T) {
	ds := GetDatasetByID("onedrive.file")
	if ds == nil {
		t.Fatal("Expected onedrive.file dataset")
	}
	if ds.ID != "onedrive.file" {
		t.Errorf("Expected onedrive.file, got %s", ds.ID)
	}

	ds = GetDatasetByID("nonexistent")
	if ds != nil {
		t.Error("Expected nil for nonexistent dataset")
	}
}

func TestOneDrive_GetSchemaByDatasetID(t *testing.T) {
	schema := GetSchemaByDatasetID("onedrive.file")
	if schema == nil {
		t.Fatal("Expected schema for onedrive.file")
	}
	if len(schema.Fields) == 0 {
		t.Error("Expected fields in schema")
	}

	schema = GetSchemaByDatasetID("nonexistent")
	if schema != nil {
		t.Error("Expected nil for nonexistent dataset")
	}
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

func skipIfNoOneDrive(t *testing.T) {
	if os.Getenv("ONEDRIVE_CLIENT_ID") == "" {
		t.Skip("ONEDRIVE_CLIENT_ID not set")
	}
	if os.Getenv("ONEDRIVE_REFRESH_TOKEN") == "" {
		t.Skip("ONEDRIVE_REFRESH_TOKEN not set")
	}
}

func getOneDriveConfig() map[string]any {
	return map[string]any{
		"clientId":     os.Getenv("ONEDRIVE_CLIENT_ID"),
		"clientSecret": os.Getenv("ONEDRIVE_CLIENT_SECRET"),
		"tenantId":     os.Getenv("ONEDRIVE_TENANT_ID"),
		"refreshToken": os.Getenv("ONEDRIVE_REFRESH_TOKEN"),
	}
}

func TestOneDrive_Integration_ValidateConfig(t *testing.T) {
	skipIfNoOneDrive(t)

	registry := endpoint.DefaultRegistry()
	config := getOneDriveConfig()

	ep, err := registry.Create("cloud.onedrive", config)
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

func TestOneDrive_Integration_ListDatasets(t *testing.T) {
	skipIfNoOneDrive(t)

	registry := endpoint.DefaultRegistry()
	config := getOneDriveConfig()

	ep, err := registry.Create("cloud.onedrive", config)
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

func TestOneDrive_Integration_ReadFiles(t *testing.T) {
	skipIfNoOneDrive(t)

	registry := endpoint.DefaultRegistry()
	config := getOneDriveConfig()

	ep, err := registry.Create("cloud.onedrive", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	sourceEp := ep.(endpoint.SourceEndpoint)

	iter, err := sourceEp.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "onedrive.file",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	defer iter.Close()

	count := 0
	for iter.Next() {
		record := iter.Value()
		t.Logf("  File: %s (%d bytes)", record["name"], record["size"])
		count++
	}

	if err := iter.Err(); err != nil {
		t.Errorf("Iterator error: %v", err)
	}

	t.Logf("✅ Read %d files", count)
}

func TestOneDrive_Integration_Capabilities(t *testing.T) {
	skipIfNoOneDrive(t)

	registry := endpoint.DefaultRegistry()
	config := getOneDriveConfig()

	ep, err := registry.Create("cloud.onedrive", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	caps := ep.GetCapabilities()
	if !caps.SupportsFull {
		t.Error("Expected SupportsFull capability")
	}
	if !caps.SupportsIncremental {
		t.Error("Expected SupportsIncremental capability")
	}

	t.Logf("✅ Capabilities: SupportsFull=%v, SupportsIncremental=%v",
		caps.SupportsFull, caps.SupportsIncremental)
}
