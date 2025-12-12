// Package temporal provides tests for Temporal activities.
package temporal

import (
	"testing"
	"time"

	"go.temporal.io/sdk/workflow"
)

func TestDefaultActivityOptions(t *testing.T) {
	// Test that we can create activity options
	opts := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		HeartbeatTimeout:    time.Minute,
	}

	if opts.StartToCloseTimeout != 10*time.Minute {
		t.Errorf("StartToCloseTimeout = %v, want %v", opts.StartToCloseTimeout, 10*time.Minute)
	}

	if opts.HeartbeatTimeout != time.Minute {
		t.Errorf("HeartbeatTimeout = %v, want %v", opts.HeartbeatTimeout, time.Minute)
	}
}

func TestNewMetadataActivities(t *testing.T) {
	// Should not panic with nil db (will fail at runtime, but creation should work)
	activities := NewMetadataActivities(nil)
	if activities == nil {
		t.Fatal("NewMetadataActivities returned nil")
	}
}

func TestJSONToStringMap(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected map[string]string
	}{
		{
			name:     "empty",
			input:    []byte{},
			expected: map[string]string{},
		},
		{
			name:     "valid json",
			input:    []byte(`{"key": "value"}`),
			expected: map[string]string{"key": "value"},
		},
		{
			name:     "non-string values",
			input:    []byte(`{"str": "value", "num": 123}`),
			expected: map[string]string{"str": "value"},
		},
		{
			name:     "invalid json",
			input:    []byte(`not json`),
			expected: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := jsonToStringMap(tt.input)
			if len(result) != len(tt.expected) {
				t.Errorf("len(result) = %d, want %d", len(result), len(tt.expected))
			}
			for k, v := range tt.expected {
				if result[k] != v {
					t.Errorf("result[%q] = %q, want %q", k, result[k], v)
				}
			}
		})
	}
}

func TestCreateCollectionRunInput(t *testing.T) {
	input := CreateCollectionRunInput{
		CollectionID: "col-123",
		EndpointID:   "ep-123",
		RequestedBy:  "user@example.com",
	}

	if input.CollectionID != "col-123" {
		t.Errorf("CollectionID = %q, want %q", input.CollectionID, "col-123")
	}
	if input.EndpointID != "ep-123" {
		t.Errorf("EndpointID = %q, want %q", input.EndpointID, "ep-123")
	}
}

func TestStartIngestionRunInput(t *testing.T) {
	input := StartIngestionRunInput{
		EndpointID: "ep-456",
		UnitID:     "unit-456",
		SinkID:     "kb",
	}
	if input.EndpointID != "ep-456" {
		t.Errorf("EndpointID = %q, want %q", input.EndpointID, "ep-456")
	}
	if input.UnitID != "unit-456" {
		t.Errorf("UnitID = %q, want %q", input.UnitID, "unit-456")
	}
	if input.SinkID != "kb" {
		t.Errorf("SinkID = %q, want %q", input.SinkID, "kb")
	}
}

func TestPersistCatalogRecordsInput(t *testing.T) {
	input := PersistCatalogRecordsInput{
		RunID:   "run-456",
		Records: []map[string]interface{}{{"id": "1"}, {"id": "2"}},
	}

	if input.RunID != "run-456" {
		t.Errorf("RunID = %q, want %q", input.RunID, "run-456")
	}
	if len(input.Records) != 2 {
		t.Errorf("len(Records) = %d, want %d", len(input.Records), 2)
	}
}

func TestPrepareCollectionJobInput(t *testing.T) {
	input := PrepareCollectionJobInput{
		RunID: "run-123",
	}
	if input.RunID != "run-123" {
		t.Errorf("RunID = %q, want %q", input.RunID, "run-123")
	}
}
