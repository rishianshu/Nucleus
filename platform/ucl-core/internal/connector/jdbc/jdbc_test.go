package jdbc_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/nucleus/ucl-core/internal/connector/jdbc"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Test database URL - set via environment variable
// METADATA_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/jira_plus_plus?schema=metadata"
func getTestDatabaseURL() string {
	url := os.Getenv("METADATA_DATABASE_URL")
	if url == "" {
		return ""
	}
	return url
}

func skipIfNoDatabase(t *testing.T) {
	if getTestDatabaseURL() == "" {
		t.Skip("Skipping integration test: METADATA_DATABASE_URL not set")
	}
}

// --- Unit Tests (no database required) ---

func TestBase_ID(t *testing.T) {
	// Test without actual DB connection - using mock config
	base := &jdbc.Base{
		DriverName: "postgres",
	}
	
	if id := base.ID(); id != "jdbc.postgres" {
		t.Errorf("Expected ID 'jdbc.postgres', got '%s'", id)
	}
}

func TestBase_GetCapabilities(t *testing.T) {
	base := &jdbc.Base{}
	caps := base.GetCapabilities()
	
	if !caps.SupportsFull {
		t.Error("Expected SupportsFull to be true")
	}
	if !caps.SupportsIncremental {
		t.Error("Expected SupportsIncremental to be true")
	}
	if !caps.SupportsMetadata {
		t.Error("Expected SupportsMetadata to be true")
	}
	if caps.DefaultFetchSize != 10000 {
		t.Errorf("Expected DefaultFetchSize 10000, got %d", caps.DefaultFetchSize)
	}
}

func TestBase_GetDescriptor(t *testing.T) {
	base := &jdbc.Base{
		DriverName: "postgres",
	}
	desc := base.GetDescriptor()
	
	if desc.ID != "jdbc.postgres" {
		t.Errorf("Expected ID 'jdbc.postgres', got '%s'", desc.ID)
	}
	if desc.Family != "JDBC" {
		t.Errorf("Expected Family 'JDBC', got '%s'", desc.Family)
	}
}

func TestBase_GetCheckpoint(t *testing.T) {
	base := &jdbc.Base{}
	ctx := context.Background()
	
	// Base implementation returns nil checkpoint
	checkpoint, err := base.GetCheckpoint(ctx, "any.dataset")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if checkpoint != nil {
		t.Error("Expected nil checkpoint for base implementation")
	}
}

// --- Interface Compliance Tests ---

func TestBase_ImplementsEndpoint(t *testing.T) {
	// This is a compile-time check - if it compiles, it passes
	var _ endpoint.Endpoint = (*endpointAdapter)(nil)
}

// endpointAdapter wraps Base to implement full endpoint.Endpoint interface
type endpointAdapter struct {
	*jdbc.Base
}

func (a *endpointAdapter) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	return a.Base.ValidateConfigEndpoint(ctx, config)
}

// --- Integration Tests (require database) ---

func TestPostgres_Integration_ValidateConfig(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	result, err := pg.ValidateConfig(ctx)
	if err != nil {
		t.Fatalf("ValidateConfig error: %v", err)
	}
	
	if !result.Valid {
		t.Errorf("Expected valid connection, got: %s", result.Message)
	}
	
	t.Logf("Connection valid, detected version: %s", result.DetectedVersion)
}

func TestPostgres_Integration_ListDatasets(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	datasets, err := pg.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets error: %v", err)
	}
	
	if len(datasets) == 0 {
		t.Log("Warning: No datasets found in database")
	} else {
		t.Logf("Found %d datasets:", len(datasets))
		for _, ds := range datasets[:min(5, len(datasets))] {
			t.Logf("  - %s (%s)", ds.ID, ds.Kind)
		}
		if len(datasets) > 5 {
			t.Logf("  ... and %d more", len(datasets)-5)
		}
	}
}

func TestPostgres_Integration_GetSchema(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	
	// First get a dataset to test schema on
	datasets, err := pg.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets error: %v", err)
	}
	
	if len(datasets) == 0 {
		t.Skip("No datasets available for schema test")
	}
	
	// Get schema for first dataset
	datasetID := datasets[0].ID
	schema, err := pg.GetSchema(ctx, datasetID)
	if err != nil {
		t.Fatalf("GetSchema error for %s: %v", datasetID, err)
	}
	
	t.Logf("Schema for %s:", datasetID)
	for _, field := range schema.Fields {
		nullable := ""
		if field.Nullable {
			nullable = " NULL"
		}
		t.Logf("  - %s: %s%s", field.Name, field.DataType, nullable)
	}
}

func TestPostgres_Integration_GetStatistics(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	
	datasets, err := pg.ListDatasets(ctx)
	if err != nil || len(datasets) == 0 {
		t.Skip("No datasets available for statistics test")
	}
	
	datasetID := datasets[0].ID
	stats, err := pg.GetStatistics(ctx, datasetID, nil)
	if err != nil {
		t.Fatalf("GetStatistics error: %v", err)
	}
	
	t.Logf("Statistics for %s: %+v", datasetID, stats)
}

func TestPostgres_Integration_Read(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	
	datasets, err := pg.ListDatasets(ctx)
	if err != nil || len(datasets) == 0 {
		t.Skip("No datasets available for read test")
	}
	
	datasetID := datasets[0].ID
	
	var count int
	err = pg.Read(ctx, datasetID, 5, func(record map[string]interface{}) error {
		count++
		if count == 1 {
			t.Logf("Sample record from %s:", datasetID)
			for k, v := range record {
				t.Logf("  %s: %v", k, v)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	
	t.Logf("Read %d records from %s", count, datasetID)
}

func TestPostgres_Integration_EndpointInterface(t *testing.T) {
	skipIfNoDatabase(t)
	
	config := parsePostgresURL(getTestDatabaseURL())
	
	pg, err := jdbc.NewPostgres(config)
	if err != nil {
		t.Fatalf("Failed to create Postgres connector: %v", err)
	}
	defer pg.Close()
	
	ctx := context.Background()
	
	// Test endpoint interface methods
	t.Run("GetCapabilities", func(t *testing.T) {
		caps := pg.GetCapabilities()
		if !caps.SupportsFull {
			t.Error("Expected SupportsFull")
		}
	})
	
	t.Run("GetDescriptor", func(t *testing.T) {
		desc := pg.GetDescriptor()
		if !strings.Contains(desc.ID, "postgres") {
			t.Errorf("Expected ID to contain 'postgres', got: %s", desc.ID)
		}
	})
	
	t.Run("ListDatasetsEndpoint", func(t *testing.T) {
		datasets, err := pg.ListDatasetsEndpoint(ctx)
		if err != nil {
			t.Errorf("ListDatasetsEndpoint error: %v", err)
		}
		t.Logf("Found %d datasets via endpoint interface", len(datasets))
	})
	
	t.Run("GetCheckpoint", func(t *testing.T) {
		cp, err := pg.GetCheckpoint(ctx, "any.table")
		if err != nil {
			t.Errorf("GetCheckpoint error: %v", err)
		}
		if cp != nil {
			t.Error("Expected nil checkpoint")
		}
	})
	
	t.Run("PlanSlices", func(t *testing.T) {
		datasets, _ := pg.ListDatasets(ctx)
		if len(datasets) == 0 {
			t.Skip("No datasets for PlanSlices test")
		}
		
		req := &endpoint.PlanRequest{
			DatasetID:       datasets[0].ID,
			Strategy:        "adaptive",
			TargetSliceSize: 1000,
		}
		
		plan, err := pg.PlanSlices(ctx, req)
		if err != nil {
			t.Errorf("PlanSlices error: %v", err)
		}
		if plan != nil {
			t.Logf("Plan: strategy=%s, slices=%d", plan.Strategy, len(plan.Slices))
		}
	})
}

// --- Helper Functions ---

func parsePostgresURL(url string) map[string]interface{} {
	// Parse postgresql://user:pass@host:port/database?schema=xxx
	config := map[string]interface{}{
		"driver": "postgres",
	}
	
	// Remove postgresql:// prefix
	url = strings.TrimPrefix(url, "postgresql://")
	url = strings.TrimPrefix(url, "postgres://")
	
	// Split on @ to get credentials and host
	parts := strings.SplitN(url, "@", 2)
	if len(parts) == 2 {
		// Parse user:password
		creds := strings.SplitN(parts[0], ":", 2)
		config["user"] = creds[0]
		if len(creds) == 2 {
			config["password"] = creds[1]
		}
		url = parts[1]
	}
	
	// Split on / to get host:port and database
	parts = strings.SplitN(url, "/", 2)
	if len(parts) >= 1 {
		// Parse host:port
		hostPort := strings.SplitN(parts[0], ":", 2)
		config["host"] = hostPort[0]
		if len(hostPort) == 2 {
			// Use port 5432 as default, actual parsing would convert string to int
			config["port"] = 5432
		}
	}
	if len(parts) == 2 {
		// Parse database?query
		dbQuery := strings.SplitN(parts[1], "?", 2)
		config["database"] = dbQuery[0]
	}
	
	return config
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
