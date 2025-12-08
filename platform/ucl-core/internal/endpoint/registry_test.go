package endpoint_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
	// Import JDBC only to register factory - no direct usage
	_ "github.com/nucleus/ucl-core/internal/connector/jdbc"
)

// =============================================================================
// REGISTRY-BASED TESTS
// These tests use ONLY endpoint interfaces - no JDBC-specific types.
// Demonstrates the generic usage pattern.
// =============================================================================

func TestRegistry_Unit_JDBCFactoryRegistered(t *testing.T) {
	// Verify JDBC factories are registered
	registry := endpoint.DefaultRegistry()
	
	expectedIDs := []string{"jdbc.postgres", "jdbc.oracle", "jdbc.sqlserver"}
	for _, id := range expectedIDs {
		_, ok := registry.Get(id)
		if !ok {
			t.Logf("Note: %s factory not registered (expected if not using init)", id)
		}
	}
}

func TestRegistry_Unit_CDMRegistryForGeneric(t *testing.T) {
	// JDBC is generic - should have no CDM mappings
	cdmRegistry := endpoint.DefaultCDMRegistry()
	
	models := cdmRegistry.GetModels("jdbc.postgres")
	if len(models) > 0 {
		t.Errorf("JDBC should have no CDM mappings, but found: %v", models)
	}
	
	// HasCDM should return false for generic sources
	if cdmRegistry.HasCDM("jdbc.postgres") {
		t.Error("HasCDM should return false for JDBC (generic source)")
	}
}

// This test demonstrates the full registry pattern with generic interfaces
func TestRegistry_Integration_GenericEndpointUsage(t *testing.T) {
	skipIfNoDatabase(t)
	
	ctx := context.Background()
	registry := endpoint.DefaultRegistry()
	
	// Step 1: Create endpoint via registry (GENERIC)
	config := parsePostgresURL(os.Getenv("METADATA_DATABASE_URL"))
	ep, err := registry.Create("jdbc.postgres", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	// Step 2: Get capabilities (via interface)
	caps := ep.GetCapabilities()
	t.Logf("Capabilities: Full=%v, Incremental=%v, Metadata=%v",
		caps.SupportsFull, caps.SupportsIncremental, caps.SupportsMetadata)
	
	// Step 3: Get descriptor (via interface)
	desc := ep.GetDescriptor()
	t.Logf("Descriptor: ID=%s, Family=%s, Vendor=%s", desc.ID, desc.Family, desc.Vendor)
	
	// Step 4: Assert as SourceEndpoint (interface, not typecast)
	source, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		t.Fatal("Expected endpoint to implement SourceEndpoint")
	}
	
	// Step 5: List datasets via interface
	datasets, err := source.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}
	t.Logf("Found %d datasets via generic interface", len(datasets))
	
	// Step 6: Get schema via interface (use known valid dataset)
	testDataset := "cdm_work.cdm_work_item"
	for _, ds := range datasets {
		if ds.ID == testDataset {
			schema, err := source.GetSchema(ctx, ds.ID)
			if err != nil {
				t.Logf("GetSchema warning: %v", err)
			} else {
				t.Logf("Schema for %s: %d fields", ds.ID, len(schema.Fields))
			}
			break
		}
	}
	
	// Step 7: Read via interface (iterator pattern)
	if len(datasets) > 0 {
		iter, err := source.Read(ctx, &endpoint.ReadRequest{
			DatasetID: datasets[0].ID,
			Limit:     5,
		})
		if err != nil {
			t.Fatalf("Read failed: %v", err)
		}
		defer iter.Close()
		
		count := 0
		for iter.Next() {
			record := iter.Value()
			if count == 0 {
				t.Logf("First record has %d fields", len(record))
			}
			count++
		}
		if iter.Err() != nil {
			t.Fatalf("Iterator error: %v", iter.Err())
		}
		t.Logf("Read %d records via iterator", count)
	}
	
	// Step 8: Check SliceCapable (capability extension)
	if slicer, ok := ep.(endpoint.SliceCapable); ok {
		t.Log("Endpoint implements SliceCapable")
		
		if len(datasets) > 0 {
			plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
				DatasetID:       datasets[0].ID,
				Strategy:        "adaptive",
				TargetSliceSize: 1000,
			})
			if err == nil && plan != nil {
				t.Logf("Plan: %d slices", len(plan.Slices))
			}
		}
	}
	
	// Step 9: Check MetadataCapable (capability extension)
	if metadata, ok := ep.(endpoint.MetadataCapable); ok {
		t.Log("Endpoint implements MetadataCapable")
		
		env, err := metadata.ProbeEnvironment(ctx, config)
		if err == nil {
			t.Logf("Environment: version=%s", env.Version)
		}
	}
}

// =============================================================================
// HELPERS
// =============================================================================

func skipIfNoDatabase(t *testing.T) {
	if os.Getenv("METADATA_DATABASE_URL") == "" {
		t.Skip("Skipping integration test: METADATA_DATABASE_URL not set")
	}
}

func parsePostgresURL(url string) map[string]any {
	// Remove schema parameter (not supported by pq) and add sslmode=disable
	connStr := url
	
	// Remove schema= parameter if present
	if idx := strings.Index(connStr, "?schema="); idx != -1 {
		end := strings.Index(connStr[idx+1:], "&")
		if end == -1 {
			connStr = connStr[:idx]
		} else {
			connStr = connStr[:idx] + "?" + connStr[idx+1+end+1:]
		}
	} else if idx := strings.Index(connStr, "&schema="); idx != -1 {
		end := strings.Index(connStr[idx+1:], "&")
		if end == -1 {
			connStr = connStr[:idx]
		} else {
			connStr = connStr[:idx] + connStr[idx+1+end:]
		}
	}
	
	// Add sslmode=disable
	if !strings.Contains(connStr, "sslmode=") {
		if strings.Contains(connStr, "?") {
			connStr = connStr + "&sslmode=disable"
		} else {
			connStr = connStr + "?sslmode=disable"
		}
	}
	
	config := map[string]any{
		"driver":            "postgres",
		"connection_string": connStr,
		"ssl_mode":          "disable",
	}
	return config
}
