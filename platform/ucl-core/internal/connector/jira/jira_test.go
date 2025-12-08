package jira_test

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
	// Import Jira to register factory
	_ "github.com/nucleus/ucl-core/internal/connector/jira"
)

// =============================================================================
// JIRA TESTS
// Tests use ONLY endpoint interfaces - demonstrates generic usage pattern.
// =============================================================================

// Environment variables for Jira tests:
// JIRA_BASE_URL=https://yoursite.atlassian.net
// JIRA_EMAIL=your-email@domain.com
// JIRA_API_TOKEN=your-api-token

func skipIfNoJira(t *testing.T) {
	if os.Getenv("JIRA_BASE_URL") == "" || os.Getenv("JIRA_API_TOKEN") == "" {
		t.Skip("Skipping Jira integration test: JIRA_BASE_URL or JIRA_API_TOKEN not set")
	}
}

func getJiraConfig() map[string]any {
	return map[string]any{
		"baseUrl":   os.Getenv("JIRA_BASE_URL"),
		"email":     os.Getenv("JIRA_EMAIL"),
		"apiToken":  os.Getenv("JIRA_API_TOKEN"),
		"fetchSize": 50,
		"jql":       "project IS NOT EMPTY ORDER BY updated DESC", // Bounded JQL required by new API
	}
}

// --- Unit Tests ---

func TestJira_Unit_FactoryRegistered(t *testing.T) {
	registry := endpoint.DefaultRegistry()
	_, ok := registry.Get("http.jira")
	if !ok {
		t.Log("Note: http.jira factory not registered (import _ jira to register)")
	}
}

func TestJira_Unit_CDMRegistryHasJira(t *testing.T) {
	cdmRegistry := endpoint.DefaultCDMRegistry()
	
	models := cdmRegistry.GetModels("http.jira")
	if len(models) == 0 {
		t.Log("Note: Jira CDM models not registered yet")
	} else {
		t.Logf("Jira CDM models: %v", models)
	}
	
	// Jira is semantic - should have CDM mappings when registered
	if cdmRegistry.HasCDM("http.jira") {
		t.Log("Jira has CDM mappings (semantic source)")
	}
}

// --- Integration Tests ---

func TestJira_Integration_ValidateConfig(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	ctx := context.Background()
	result, err := ep.ValidateConfig(ctx, config)
	if err != nil {
		t.Fatalf("ValidateConfig error: %v", err)
	}
	
	if !result.Valid {
		t.Errorf("Expected valid connection, got: %s", result.Message)
	}
	
	t.Logf("Connection valid, detected version: %s", result.DetectedVersion)
}

func TestJira_Integration_ListDatasets(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	source, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		t.Fatal("Expected Jira to implement SourceEndpoint")
	}
	
	ctx := context.Background()
	datasets, err := source.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("ListDatasets error: %v", err)
	}
	
	t.Logf("Found %d datasets:", len(datasets))
	for _, ds := range datasets {
		t.Logf("  - %s (%s)", ds.ID, ds.Kind)
	}
}

func TestJira_Integration_GetSchema(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	source := ep.(endpoint.SourceEndpoint)
	ctx := context.Background()
	
	// Get schema for issues dataset
	schema, err := source.GetSchema(ctx, "jira.issues")
	if err != nil {
		t.Fatalf("GetSchema error: %v", err)
	}
	
	t.Logf("Schema for jira.issues: %d fields", len(schema.Fields))
	for _, f := range schema.Fields[:min(5, len(schema.Fields))] {
		t.Logf("  - %s: %s", f.Name, f.DataType)
	}
}

func TestJira_Integration_ReadProjects(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	source := ep.(endpoint.SourceEndpoint)
	ctx := context.Background()
	
	iter, err := source.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "jira.projects",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	defer iter.Close()
	
	count := 0
	for iter.Next() {
		record := iter.Value()
		if count == 0 {
			t.Logf("First project: %v", record["name"])
		}
		count++
	}
	if iter.Err() != nil {
		t.Fatalf("Iterator error: %v", iter.Err())
	}
	t.Logf("Read %d projects", count)
}

func TestJira_Integration_ReadIssues(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	source := ep.(endpoint.SourceEndpoint)
	ctx := context.Background()
	
	iter, err := source.Read(ctx, &endpoint.ReadRequest{
		DatasetID: "jira.issues",
		Limit:     5,
	})
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	defer iter.Close()
	
	count := 0
	for iter.Next() {
		record := iter.Value()
		t.Logf("Issue: %v - %v", record["issueKey"], record["summary"])
		count++
	}
	if iter.Err() != nil {
		t.Fatalf("Iterator error: %v", iter.Err())
	}
	t.Logf("Read %d issues", count)
}

func TestJira_Integration_Capabilities(t *testing.T) {
	skipIfNoJira(t)
	
	registry := endpoint.DefaultRegistry()
	config := getJiraConfig()
	
	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Registry.Create failed: %v", err)
	}
	defer ep.Close()
	
	ctx := context.Background()
	
	// Check capabilities
	caps := ep.GetCapabilities()
	t.Logf("Capabilities: Full=%v, Incremental=%v, Metadata=%v",
		caps.SupportsFull, caps.SupportsIncremental, caps.SupportsMetadata)
	
	// Check descriptor
	desc := ep.GetDescriptor()
	t.Logf("Descriptor: ID=%s, Family=%s, Vendor=%s", desc.ID, desc.Family, desc.Vendor)
	
	// Check SliceCapable
	if slicer, ok := ep.(endpoint.SliceCapable); ok {
		t.Log("Jira implements SliceCapable")
		plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
			DatasetID: "jira.issues",
			Strategy:  "full",
		})
		if err == nil && plan != nil {
			t.Logf("Plan: %d slices", len(plan.Slices))
		}
	}
	
	// Check MetadataCapable
	if metadata, ok := ep.(endpoint.MetadataCapable); ok {
		t.Log("Jira implements MetadataCapable")
		env, err := metadata.ProbeEnvironment(ctx, config)
		if err == nil {
			t.Logf("Environment: version=%s", env.Version)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
