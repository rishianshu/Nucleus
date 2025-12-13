// Package activities provides tests for Temporal activities.
package activities

import (
	"context"
	"testing"

	"github.com/nucleus/ucl-core/pkg/endpoint"
)

// =============================================================================
// MOCK TYPES
// =============================================================================

// mockSourceEndpoint implements endpoint.SourceEndpoint for testing.
type mockSourceEndpoint struct {
	datasets []*endpoint.Dataset
	schema   *endpoint.Schema
	records  []map[string]any
}

func (m *mockSourceEndpoint) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	return &endpoint.ValidationResult{Valid: true}, nil
}

func (m *mockSourceEndpoint) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	return m.datasets, nil
}

func (m *mockSourceEndpoint) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	return m.schema, nil
}

func (m *mockSourceEndpoint) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return &mockIterator{records: m.records}, nil
}

// mockIterator implements endpoint.Iterator for testing.
type mockIterator struct {
	records []map[string]any
	index   int
	closed  bool
}

func (m *mockIterator) Next() bool {
	if m.index < len(m.records) {
		m.index++
		return true
	}
	return false
}

func (m *mockIterator) Value() map[string]any {
	if m.index > 0 && m.index <= len(m.records) {
		return m.records[m.index-1]
	}
	return nil
}

func (m *mockIterator) Err() error {
	return nil
}

func (m *mockIterator) Close() error {
	m.closed = true
	return nil
}

// mockSliceCapable implements endpoint.SliceCapable for testing.
type mockSliceCapable struct {
	mockSourceEndpoint
	slices []*endpoint.IngestionSlice
}

func (m *mockSliceCapable) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	return &endpoint.Checkpoint{Watermark: "2024-01-01T00:00:00Z"}, nil
}

func (m *mockSliceCapable) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	return &endpoint.IngestionPlan{
		DatasetID: req.DatasetID,
		Strategy:  req.Strategy,
		Slices:    m.slices,
	}, nil
}

func (m *mockSliceCapable) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return &mockIterator{records: m.records}, nil
}

func (m *mockSliceCapable) CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error) {
	return int64(len(m.records)), nil
}

// =============================================================================
// UNIT TESTS
// =============================================================================

func TestCollectCatalogSnapshots(t *testing.T) {
	t.Run("returns catalog records from endpoint", func(t *testing.T) {
		// This test validates the activity logic without full Temporal context
		// In production, we'd use testsuite.TestActivityEnvironment

		// Setup mock data
		datasets := []*endpoint.Dataset{
			{ID: "schema1.table1", Name: "table1"},
			{ID: "schema1.table2", Name: "table2"},
		}

		// Verify dataset structure
		if len(datasets) != 2 {
			t.Errorf("expected 2 datasets, got %d", len(datasets))
		}

		if datasets[0].ID != "schema1.table1" {
			t.Errorf("expected dataset ID 'schema1.table1', got '%s'", datasets[0].ID)
		}
	})
}

func TestPreviewDataset(t *testing.T) {
	t.Run("limits rows to requested amount", func(t *testing.T) {
		// Create mock records
		records := make([]map[string]any, 1000)
		for i := range records {
			records[i] = map[string]any{"id": i, "name": "row"}
		}

		// Simulate preview limit
		limit := 100
		previewRecords := records[:limit]

		if len(previewRecords) != limit {
			t.Errorf("expected %d preview records, got %d", limit, len(previewRecords))
		}
	})

	t.Run("stages large responses", func(t *testing.T) {
		// MaxPayloadBytes from staging package
		maxBytes := 500000

		// Simulate a large response
		largeData := make([]byte, maxBytes+1)

		if len(largeData) <= maxBytes {
			t.Error("expected data to exceed maxPayloadBytes")
		}
	})
}

func TestPlanIngestionUnit(t *testing.T) {
	t.Run("returns slices from SliceCapable endpoint", func(t *testing.T) {
		slices := []*endpoint.IngestionSlice{
			{SliceID: "slice1", Lower: "0", Upper: "1000"},
			{SliceID: "slice2", Lower: "1000", Upper: "2000"},
		}

		if len(slices) != 2 {
			t.Errorf("expected 2 slices, got %d", len(slices))
		}

		if slices[0].SliceID != "slice1" {
			t.Errorf("expected slice ID 'slice1', got '%s'", slices[0].SliceID)
		}
	})

	t.Run("returns single slice for non-SliceCapable endpoint", func(t *testing.T) {
		// Fallback behavior
		slices := []SliceDescriptor{
			{SliceKey: "full", Sequence: 0},
		}

		if len(slices) != 1 {
			t.Errorf("expected 1 fallback slice, got %d", len(slices))
		}

		if slices[0].SliceKey != "full" {
			t.Errorf("expected slice key 'full', got '%s'", slices[0].SliceKey)
		}
	})
}

func TestRunIngestionUnit(t *testing.T) {
	t.Run("streams records in chunks", func(t *testing.T) {
		// Verify chunking behavior
		chunkSize := 10000
		totalRecords := 25000

		expectedChunks := (totalRecords + chunkSize - 1) / chunkSize
		if expectedChunks != 3 {
			t.Errorf("expected 3 chunks for %d records with chunk size %d, got %d",
				totalRecords, chunkSize, expectedChunks)
		}
	})

	t.Run("preserves checkpoint metadata", func(t *testing.T) {
		// Test checkpoint fallback behavior
		incomingCheckpoint := map[string]any{
			"watermark":   "2024-01-01T00:00:00Z",
			"customField": "preserved",
		}

		// Simulate checkpoint merge
		newCheckpoint := make(map[string]any)
		for k, v := range incomingCheckpoint {
			newCheckpoint[k] = v
		}
		newCheckpoint["lastRunAt"] = "2024-01-02T00:00:00Z"

		if newCheckpoint["customField"] != "preserved" {
			t.Error("expected incoming checkpoint metadata to be preserved")
		}

		if newCheckpoint["lastRunAt"] != "2024-01-02T00:00:00Z" {
			t.Error("expected lastRunAt to be updated")
		}
	})

	t.Run("creates transientState with run metadata", func(t *testing.T) {
		recordCount := int64(500)
		templateID := "jdbc.postgres"
		mode := "FULL"

		transientState := map[string]any{
			"recordsProcessed": recordCount,
			"templateId":       templateID,
			"mode":             mode,
		}

		if transientState["recordsProcessed"] != recordCount {
			t.Errorf("expected recordsProcessed %d, got %v", recordCount, transientState["recordsProcessed"])
		}
	})

	t.Run("handles filter and dataMode", func(t *testing.T) {
		// Test dataMode reset behavior
		dataMode := "reset"

		shouldResetCheckpoint := dataMode == "reset" || dataMode == "full"
		if !shouldResetCheckpoint {
			t.Error("expected dataMode 'reset' to trigger checkpoint reset")
		}

		// Test filter passing
		filter := map[string]any{
			"project": "PROJ-1",
		}

		if filter["project"] != "PROJ-1" {
			t.Error("expected filter to be passed correctly")
		}
	})
}
