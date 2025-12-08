package confluence

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// TEST HELPERS
// =============================================================================

func getConfluenceConfig() map[string]any {
	return map[string]any{
		"baseUrl":  os.Getenv("CONFLUENCE_BASE_URL"),
		"email":    os.Getenv("CONFLUENCE_EMAIL"),
		"apiToken": os.Getenv("CONFLUENCE_API_TOKEN"),
	}
}

func skipIfNoConfluence(t *testing.T) {
	if os.Getenv("CONFLUENCE_BASE_URL") == "" || os.Getenv("CONFLUENCE_API_TOKEN") == "" {
		t.Skip("CONFLUENCE_BASE_URL or CONFLUENCE_API_TOKEN not set")
	}
}

// =============================================================================
// UNIT TESTS
// =============================================================================

func TestConfluence_FactoryRegistration(t *testing.T) {
	registry := endpoint.DefaultRegistry()

	_, ok := registry.Get("http.confluence")
	if !ok {
		t.Log("Note: http.confluence factory not registered (import _ confluence to register)")
	}
}

func TestConfluence_CDMRegistry(t *testing.T) {
	cdmRegistry := endpoint.DefaultCDMRegistry()

	models := cdmRegistry.GetModels("http.confluence")
	if len(models) == 0 {
		t.Log("Note: No CDM models registered for http.confluence yet")
	}

	if cdmRegistry.HasCDM("http.confluence") {
		t.Logf("Confluence CDM models: %v", models)
	}
}

// =============================================================================
// INTEGRATION TESTS - Catalog
// =============================================================================

func TestConfluence_Integration_ValidateConfig(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	result, err := ep.ValidateConfig(ctx, config)
	if err != nil {
		t.Fatalf("ValidateConfig failed: %v", err)
	}

	if !result.Valid {
		t.Errorf("Expected valid config, got: %s", result.Message)
	}

	t.Logf("CATALOG: Connected - %s", result.Message)
}

func TestConfluence_Integration_ListDatasets(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	datasets, err := source.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}

	if len(datasets) == 0 {
		t.Error("Expected at least one dataset")
	}

	t.Logf("CATALOG: Found %d datasets:", len(datasets))
	for _, ds := range datasets {
		cdmInfo := ""
		if ds.CdmModelID != "" {
			cdmInfo = " → " + ds.CdmModelID
		}
		t.Logf("  [%s] %s (%s)%s", ds.Kind, ds.ID, ds.Name, cdmInfo)
	}
}

// =============================================================================
// INTEGRATION TESTS - Preview (Schema)
// =============================================================================

func TestConfluence_Integration_GetSchema_Space(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	schema, err := source.GetSchema(ctx, "confluence.space")
	if err != nil {
		t.Fatalf("GetSchema failed: %v", err)
	}

	if len(schema.Fields) == 0 {
		t.Error("Expected schema fields for spaces")
	}

	t.Logf("PREVIEW: confluence.space schema (%d fields):", len(schema.Fields))
	for _, f := range schema.Fields {
		nullable := ""
		if f.Nullable {
			nullable = " (null)"
		}
		t.Logf("  %s: %s%s", f.Name, f.DataType, nullable)
	}
}

func TestConfluence_Integration_GetSchema_Page(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	schema, err := source.GetSchema(ctx, "confluence.page")
	if err != nil {
		t.Fatalf("GetSchema failed: %v", err)
	}

	t.Logf("PREVIEW: confluence.page schema (%d fields):", len(schema.Fields))
	for _, f := range schema.Fields {
		t.Logf("  %s: %s", f.Name, f.DataType)
	}
}

// =============================================================================
// INTEGRATION TESTS - Ingest (Read)
// =============================================================================

func TestConfluence_Integration_ReadSpaces(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	iter, err := source.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "confluence.space",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	defer iter.Close()

	count := 0
	for iter.Next() && count < 10 {
		record := iter.Value()
		t.Logf("INGEST: Space '%s' (%s)", record["name"], record["spaceKey"])
		count++
	}

	if iter.Err() != nil {
		t.Fatalf("Iterator error: %v", iter.Err())
	}

	t.Logf("INGEST: Read %d spaces", count)
	if count == 0 {
		t.Log("WARNING: No spaces found - check Confluence permissions")
	}
}

func TestConfluence_Integration_ReadPages(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	iter, err := source.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "confluence.page",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	defer iter.Close()

	count := 0
	for iter.Next() && count < 10 {
		record := iter.Value()
		t.Logf("INGEST: Page '%s' in space %s", record["title"], record["spaceKey"])
		count++
	}

	if iter.Err() != nil {
		t.Fatalf("Iterator error: %v", iter.Err())
	}

	t.Logf("INGEST: Read %d pages", count)
}

// =============================================================================
// INTEGRATION TESTS - Capabilities
// =============================================================================

func TestConfluence_Integration_MetadataCapable(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()

	// Check MetadataCapable
	metaCapable, ok := ep.(endpoint.MetadataCapable)
	if !ok {
		t.Fatal("Expected endpoint to implement MetadataCapable")
	}

	env, err := metaCapable.ProbeEnvironment(ctx, config)
	if err != nil {
		t.Fatalf("ProbeEnvironment failed: %v", err)
	}

	t.Logf("METADATA: Environment version: %s", env.Version)
	t.Logf("METADATA: Properties: %+v", env.Properties)
}

func TestConfluence_Integration_SliceCapable(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()

	// Check SliceCapable
	slicer, ok := ep.(endpoint.SliceCapable)
	if !ok {
		t.Fatal("Expected endpoint to implement SliceCapable")
	}

	plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID:       "confluence.page",
		Strategy:        "full",
		TargetSliceSize: 100,
	})
	if err != nil {
		t.Fatalf("PlanSlices failed: %v", err)
	}

	t.Logf("SLICE: Plan strategy: %s", plan.Strategy)
	t.Logf("SLICE: Slices: %d", len(plan.Slices))

	// Execute first slice
	if len(plan.Slices) > 0 {
		iter, err := slicer.ReadSlice(ctx, &endpoint.SliceReadRequest{
			DatasetID: "confluence.page",
			Slice:     plan.Slices[0],
		})
		if err != nil {
			t.Fatalf("ReadSlice failed: %v", err)
		}

		count := 0
		for iter.Next() && count < 5 {
			count++
		}
		iter.Close()

		t.Logf("SLICE: Read %d records from first slice", count)
	}
}

func TestConfluence_Integration_Descriptor(t *testing.T) {
	skipIfNoConfluence(t)

	registry := endpoint.DefaultRegistry()
	config := getConfluenceConfig()

	ep, err := registry.Create("http.confluence", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	desc := ep.GetDescriptor()

	t.Logf("DESCRIPTOR: ID=%s, Title=%s", desc.ID, desc.Title)
	t.Logf("DESCRIPTOR: Family=%s, Vendor=%s", desc.Family, desc.Vendor)
	t.Logf("DESCRIPTOR: %d config fields", len(desc.Fields))

	for _, f := range desc.Fields {
		required := ""
		if f.Required {
			required = " (required)"
		}
		t.Logf("  %s: %s%s", f.Key, f.ValueType, required)
	}
}
