package endpoint_test

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
	// Import connectors to register factories
	_ "github.com/nucleus/ucl-core/internal/connector/jdbc"
	_ "github.com/nucleus/ucl-core/internal/connector/jira"
)

// =============================================================================
// UI-DRIVEN INTEGRATION TESTS
// These tests simulate what a UI would see - using ONLY endpoint APIs to:
// 1. Discover endpoints (Registry)
// 2. Get config schema (Descriptor fields)
// 3. Catalog datasets (ListDatasets)
// 4. Preview schema (GetSchema)
// 5. Ingest data (Read with iterator)
// NO HARDCODED KNOWLEDGE - everything comes from endpoint APIs.
// =============================================================================

func TestUI_Discovery_EndpointCatalog(t *testing.T) {
	// UI Step 1: What endpoints are available?
	registry := endpoint.DefaultRegistry()
	endpoints := registry.List()

	if len(endpoints) == 0 {
		t.Fatal("No endpoints registered - UI would show empty list")
	}

	t.Logf("UI: Found %d endpoint types available:", len(endpoints))
	for _, id := range endpoints {
		t.Logf("  - %s", id)
	}

	// Assertions
	if !contains(endpoints, "jdbc.postgres") {
		t.Error("Expected jdbc.postgres to be registered")
	}
	if !contains(endpoints, "http.jira") {
		t.Error("Expected http.jira to be registered")
	}
}

func TestUI_Discovery_JiraDescriptor(t *testing.T) {
	// UI Step 2: What config does Jira need?
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	ep, err := registry.Create("http.jira", minimalJiraConfig())
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	desc := ep.GetDescriptor()

	// UI would render form from descriptor
	t.Logf("UI: Showing config form for '%s'", desc.Title)
	t.Logf("  ID: %s", desc.ID)
	t.Logf("  Family: %s", desc.Family)
	t.Logf("  Vendor: %s", desc.Vendor)
	t.Logf("  Description: %s", desc.Description)

	// Assertions - verify descriptor has expected structure
	if desc.ID != "http.jira" {
		t.Errorf("Expected ID 'http.jira', got '%s'", desc.ID)
	}
	if desc.Vendor == "" {
		t.Error("Vendor should not be empty")
	}

	// UI would show config fields
	t.Logf("  Config fields: %d", len(desc.Fields))
	for _, f := range desc.Fields {
		required := ""
		if f.Required {
			required = " (required)"
		}
		t.Logf("    - %s: %s%s", f.Key, f.ValueType, required)
	}

	// UI would show capabilities
	caps := ep.GetCapabilities()
	t.Logf("  Capabilities: Full=%v, Incremental=%v, Metadata=%v",
		caps.SupportsFull, caps.SupportsIncremental, caps.SupportsMetadata)
}

func TestUI_Catalog_ListAvailableDatasets(t *testing.T) {
	// UI Step 3: After connection, what datasets are available?
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	config := minimalJiraConfig()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	source, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		t.Fatal("Expected endpoint to be SourceEndpoint")
	}

	ctx := context.Background()
	datasets, err := source.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}

	// Assertions
	if len(datasets) == 0 {
		t.Fatal("Expected at least one dataset")
	}

	t.Logf("UI: Available datasets for ingestion (%d):", len(datasets))
	var issuesDataset *endpoint.Dataset
	for _, ds := range datasets {
		cdm := ""
		if ds.CdmModelID != "" {
			cdm = " → " + ds.CdmModelID
		}
		t.Logf("  [%s] %s (%s)%s", ds.Kind, ds.ID, ds.Name, cdm)
		if ds.ID == "jira.issues" {
			issuesDataset = ds
		}
	}

	// Verify issues dataset exists
	if issuesDataset == nil {
		t.Error("Expected jira.issues dataset in catalog")
	}
}

func TestUI_Preview_SchemaDiscovery(t *testing.T) {
	// UI Step 4: User wants to preview a dataset - get its schema
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	ep, err := registry.Create("http.jira", minimalJiraConfig())
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	source := ep.(endpoint.SourceEndpoint)
	ctx := context.Background()

	// First get available datasets
	datasets, _ := source.ListDatasets(ctx)
	if len(datasets) == 0 {
		t.Skip("No datasets available")
	}

	// Pick first dataset (UI would let user select)
	selectedDataset := datasets[0]
	t.Logf("UI: User selected dataset '%s' for preview", selectedDataset.ID)

	// Get schema for selected dataset
	schema, err := source.GetSchema(ctx, selectedDataset.ID)
	if err != nil {
		t.Fatalf("GetSchema failed: %v", err)
	}

	// Assertions
	if len(schema.Fields) == 0 {
		t.Error("Expected schema to have fields")
	}

	t.Logf("UI: Preview columns for '%s':", selectedDataset.ID)
	for _, f := range schema.Fields {
		nullable := ""
		if f.Nullable {
			nullable = " (null)"
		}
		t.Logf("  %s: %s%s", f.Name, f.DataType, nullable)
	}
}

func TestUI_Ingest_ReadWithIterator(t *testing.T) {
	// UI Step 5: User clicks "Ingest" - read data
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	config := minimalJiraConfig()
	config["jql"] = "project IS NOT EMPTY ORDER BY updated DESC"

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	source := ep.(endpoint.SourceEndpoint)
	ctx := context.Background()

	// Get catalog and pick a dataset
	datasets, _ := source.ListDatasets(ctx)
	var ingestionDataset string
	for _, ds := range datasets {
		if ds.ID == "jira.projects" {
			ingestionDataset = ds.ID
			break
		}
	}
	if ingestionDataset == "" {
		ingestionDataset = datasets[0].ID
	}

	t.Logf("UI: Starting ingestion for '%s'", ingestionDataset)

	// Read with limit (simulation of preview/ingest)
	iter, err := source.Read(ctx, &endpoint.ReadRequest{
		DatasetID: ingestionDataset,
		Limit:     5,
	})
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	defer iter.Close()

	// Count and verify records
	var records []endpoint.Record
	for iter.Next() {
		records = append(records, iter.Value())
	}
	if iter.Err() != nil {
		t.Fatalf("Iterator error: %v", iter.Err())
	}

	// Assertions
	if len(records) == 0 {
		t.Error("Expected at least one record")
	}

	t.Logf("UI: Ingested %d records", len(records))
	if len(records) > 0 {
		t.Logf("UI: Sample record keys: %v", getKeys(records[0]))
	}
}

func TestUI_CDM_SemanticMappings(t *testing.T) {
	// UI Step 6: Show CDM mappings for semantic sources
	cdmRegistry := endpoint.DefaultCDMRegistry()

	// Check Jira CDM mappings
	if cdmRegistry.HasCDM("http.jira") {
		t.Log("UI: Jira is a semantic source with CDM mappings")
		models := cdmRegistry.GetModels("http.jira")
		t.Logf("  CDM Models: %v", models)
	}

	// JDBC should NOT have CDM (generic)
	if !cdmRegistry.HasCDM("jdbc.postgres") {
		t.Log("UI: JDBC is a generic source (no CDM)")
	} else {
		t.Error("Expected JDBC to have no CDM mappings")
	}
}

func TestUI_SliceCapable_PlanIngestion(t *testing.T) {
	// UI Step 7: For large datasets, plan sliced ingestion
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	config := minimalJiraConfig()
	config["jql"] = "project IS NOT EMPTY"

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	slicer, ok := ep.(endpoint.SliceCapable)
	if !ok {
		t.Skip("Endpoint does not implement SliceCapable")
	}

	ctx := context.Background()

	// Get a dataset
	source := ep.(endpoint.SourceEndpoint)
	datasets, _ := source.ListDatasets(ctx)
	if len(datasets) == 0 {
		t.Skip("No datasets")
	}

	// Plan slices
	plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID: datasets[0].ID,
		Strategy:  "full",
	})
	if err != nil {
		t.Logf("PlanSlices warning: %v", err)
		return
	}

	t.Logf("UI: Ingestion plan for '%s':", datasets[0].ID)
	t.Logf("  Strategy: %s", plan.Strategy)
	t.Logf("  Slices: %d", len(plan.Slices))
}

func TestUI_MetadataCapable_ProbeEnvironment(t *testing.T) {
	// UI Step 8: Probe environment for metadata
	skipIfNoJiraEnv(t)

	registry := endpoint.DefaultRegistry()
	config := minimalJiraConfig()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	metadata, ok := ep.(endpoint.MetadataCapable)
	if !ok {
		t.Skip("Endpoint does not implement MetadataCapable")
	}

	ctx := context.Background()

	env, err := metadata.ProbeEnvironment(ctx, config)
	if err != nil {
		t.Fatalf("ProbeEnvironment failed: %v", err)
	}

	t.Logf("UI: Environment info:")
	t.Logf("  Version: %s", env.Version)
	t.Logf("  Properties: %v", env.Properties)

	// Assertion
	if env.Version == "" {
		t.Error("Expected environment version")
	}
}

// =============================================================================
// HELPERS (minimal - only for test infrastructure)
// =============================================================================

func skipIfNoJiraEnv(t *testing.T) {
	if os.Getenv("JIRA_BASE_URL") == "" || os.Getenv("JIRA_API_TOKEN") == "" {
		t.Skip("JIRA_BASE_URL or JIRA_API_TOKEN not set")
	}
}

func minimalJiraConfig() map[string]any {
	return map[string]any{
		"baseUrl":  os.Getenv("JIRA_BASE_URL"),
		"email":    os.Getenv("JIRA_EMAIL"),
		"apiToken": os.Getenv("JIRA_API_TOKEN"),
	}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func getKeys(m endpoint.Record) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
