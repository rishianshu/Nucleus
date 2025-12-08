package endpoint_test

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
	// Import connectors
	_ "github.com/nucleus/ucl-core/internal/connector/jdbc"
	_ "github.com/nucleus/ucl-core/internal/connector/jira"
)

// =============================================================================
// INGESTION WORKFLOW TESTS
// Tests the complete ingestion flow: Plan → Slice → Read → Checkpoint
// =============================================================================

func TestIngestion_PlanAndExecute(t *testing.T) {
	skipIfNoJira(t)

	registry := endpoint.DefaultRegistry()
	config := jiraConfigWithJQL()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	// Step 1: Select dataset from catalog
	datasets, _ := source.ListDatasets(ctx)
	if len(datasets) == 0 {
		t.Skip("No datasets")
	}

	var targetDataset *endpoint.Dataset
	for _, ds := range datasets {
		if ds.ID == "jira.projects" {
			targetDataset = ds
			break
		}
	}
	if targetDataset == nil {
		targetDataset = datasets[0]
	}

	t.Logf("INGESTION: Selected dataset '%s'", targetDataset.ID)

	// Step 2: Plan ingestion slices
	slicer, ok := ep.(endpoint.SliceCapable)
	if !ok {
		t.Skip("Endpoint does not implement SliceCapable")
	}

	plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID:       targetDataset.ID,
		Strategy:        "full",
		TargetSliceSize: 100,
	})
	if err != nil {
		t.Fatalf("PlanSlices failed: %v", err)
	}

	t.Logf("INGESTION: Plan created with strategy '%s'", plan.Strategy)
	t.Logf("INGESTION: %d slices planned", len(plan.Slices))

	// Assertions on plan
	if len(plan.Slices) == 0 {
		t.Error("Expected at least one slice in plan")
	}

	// Step 3: Execute each slice
	var totalRecords int
	const maxPerSlice = 10 // Test limit
	for i, slice := range plan.Slices {
		t.Logf("INGESTION: Executing slice %d/%d (ID: %s)", i+1, len(plan.Slices), slice.SliceID)

		// Read slice
		iter, err := slicer.ReadSlice(ctx, &endpoint.SliceReadRequest{
			DatasetID: targetDataset.ID,
			Slice:     slice,
		})
		if err != nil {
			t.Logf("INGESTION: ReadSlice error: %v", err)
			continue
		}

		sliceCount := 0
		for iter.Next() && sliceCount < maxPerSlice {
			sliceCount++
		}
		iter.Close()

		if iter.Err() != nil {
			t.Logf("INGESTION: Iterator error: %v", iter.Err())
		}

		totalRecords += sliceCount
		t.Logf("INGESTION: Slice %d yielded %d records (max %d)", i+1, sliceCount, maxPerSlice)
	}

	t.Logf("INGESTION: Total records ingested: %d", totalRecords)

	// Assertions
	if totalRecords == 0 {
		t.Error("Expected to ingest at least one record")
	}
}

func TestIngestion_IncrementalCapable(t *testing.T) {
	skipIfNoJira(t)

	registry := endpoint.DefaultRegistry()
	config := jiraConfigWithJQL()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()

	// Check IncrementalCapable
	incremental, ok := ep.(endpoint.IncrementalCapable)
	if !ok {
		t.Skip("Endpoint does not implement IncrementalCapable")
	}

	// Get checkpoint for a dataset
	cp, err := incremental.GetCheckpoint(ctx, "jira.issues")
	if err != nil {
		t.Fatalf("GetCheckpoint failed: %v", err)
	}

	if cp == nil {
		t.Log("INGESTION: No checkpoint (first sync)")
	} else {
		t.Logf("INGESTION: Checkpoint exists")
	}

	// Verify CountBetween for incremental planning
	slicer := ep.(endpoint.SliceCapable)
	count, err := slicer.CountBetween(ctx, "jira.issues", "2024-01-01T00:00:00Z", "")
	if err != nil {
		t.Logf("INGESTION: CountBetween error (expected for some endpoints): %v", err)
	} else {
		t.Logf("INGESTION: CountBetween returned %d records since 2024-01-01", count)
	}
}

func TestIngestion_FullWorkflow_WithAssertions(t *testing.T) {
	skipIfNoJira(t)

	registry := endpoint.DefaultRegistry()
	config := jiraConfigWithJQL()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	source := ep.(endpoint.SourceEndpoint)

	// --- PHASE 1: CATALOG ---
	t.Log("▶ PHASE 1: CATALOG")
	datasets, err := source.ListDatasets(ctx)
	if err != nil {
		t.Fatalf("Catalog failed: %v", err)
	}
	if len(datasets) == 0 {
		t.Fatal("Catalog returned no datasets")
	}
	t.Logf("  ✓ Found %d datasets in catalog", len(datasets))

	// Verify CDM mappings in catalog
	var cdmMappedCount int
	for _, ds := range datasets {
		if ds.CdmModelID != "" {
			cdmMappedCount++
		}
	}
	t.Logf("  ✓ %d datasets have CDM mappings", cdmMappedCount)

	// --- PHASE 2: PREVIEW (Schema) ---
	t.Log("▶ PHASE 2: PREVIEW")
	targetDS := datasets[0]
	schema, err := source.GetSchema(ctx, targetDS.ID)
	if err != nil {
		t.Fatalf("Preview failed: %v", err)
	}
	if len(schema.Fields) == 0 {
		t.Error("Schema has no fields")
	}
	t.Logf("  ✓ Schema has %d fields", len(schema.Fields))

	// --- PHASE 3: PLAN ---
	t.Log("▶ PHASE 3: PLAN")
	slicer, ok := ep.(endpoint.SliceCapable)
	if !ok {
		t.Log("  ⚠ SliceCapable not implemented, skipping slice tests")
		return
	}

	plan, err := slicer.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID:       targetDS.ID,
		Strategy:        "full",
		TargetSliceSize: 1000,
	})
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if plan == nil {
		t.Fatal("Plan is nil")
	}
	t.Logf("  ✓ Plan created: strategy=%s, slices=%d", plan.Strategy, len(plan.Slices))

	// Assert plan structure
	for i, slice := range plan.Slices {
		if slice.SliceID == "" {
			t.Errorf("Slice %d has empty SliceID", i)
		}
	}

	// --- PHASE 4: INGEST ---
	t.Log("▶ PHASE 4: INGEST")
	var totalIngested int
	for _, slice := range plan.Slices {
		iter, err := slicer.ReadSlice(ctx, &endpoint.SliceReadRequest{
			DatasetID: targetDS.ID,
			Slice:     slice,
		})
		if err != nil {
			t.Logf("  ReadSlice error: %v", err)
			continue
		}

		count := 0
		for iter.Next() {
			record := iter.Value()
			// Verify record is not empty
			if len(record) == 0 {
				t.Error("Record is empty")
			}
			count++
		}
		iter.Close()
		totalIngested += count
	}
	t.Logf("  ✓ Ingested %d total records", totalIngested)

	// --- PHASE 5: CHECKPOINT ---
	t.Log("▶ PHASE 5: CHECKPOINT")
	if incremental, ok := ep.(endpoint.IncrementalCapable); ok {
		cp, _ := incremental.GetCheckpoint(ctx, targetDS.ID)
		if cp != nil {
			t.Logf("  ✓ Checkpoint: %+v", cp)
		} else {
			t.Log("  ✓ No checkpoint (initial sync)")
		}
	}

	t.Log("▶ INGESTION COMPLETE")
}

// =============================================================================
// HELPERS
// =============================================================================

func skipIfNoJira(t *testing.T) {
	if os.Getenv("JIRA_BASE_URL") == "" || os.Getenv("JIRA_API_TOKEN") == "" {
		t.Skip("JIRA_BASE_URL or JIRA_API_TOKEN not set")
	}
}

func jiraConfigWithJQL() map[string]any {
	return map[string]any{
		"baseUrl":  os.Getenv("JIRA_BASE_URL"),
		"email":    os.Getenv("JIRA_EMAIL"),
		"apiToken": os.Getenv("JIRA_API_TOKEN"),
		"jql":      "project IS NOT EMPTY ORDER BY updated DESC",
	}
}
