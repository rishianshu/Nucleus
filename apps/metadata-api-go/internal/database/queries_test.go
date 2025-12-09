// Package database provides tests for database queries.
package database

import (
	"testing"
)

func TestToNullString(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantVal  string
		wantNull bool
	}{
		{
			name:     "empty string",
			input:    "",
			wantVal:  "",
			wantNull: false,
		},
		{
			name:     "non-empty string",
			input:    "hello",
			wantVal:  "hello",
			wantNull: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ToNullString(tt.input)
			if result.String != tt.wantVal {
				t.Errorf("ToNullString(%q).String = %q, want %q", tt.input, result.String, tt.wantVal)
			}
			if result.Valid != tt.wantNull {
				t.Errorf("ToNullString(%q).Valid = %v, want %v", tt.input, result.Valid, tt.wantNull)
			}
		})
	}
}

func TestCollectionStatusConstants(t *testing.T) {
	// Test that status constants have correct values
	if string(CollectionStatusQueued) != "QUEUED" {
		t.Errorf("CollectionStatusQueued = %q, want %q", string(CollectionStatusQueued), "QUEUED")
	}
	if string(CollectionStatusRunning) != "RUNNING" {
		t.Errorf("CollectionStatusRunning = %q, want %q", string(CollectionStatusRunning), "RUNNING")
	}
	if string(CollectionStatusSucceeded) != "SUCCEEDED" {
		t.Errorf("CollectionStatusSucceeded = %q, want %q", string(CollectionStatusSucceeded), "SUCCEEDED")
	}
	if string(CollectionStatusFailed) != "FAILED" {
		t.Errorf("CollectionStatusFailed = %q, want %q", string(CollectionStatusFailed), "FAILED")
	}
	if string(CollectionStatusSkipped) != "SKIPPED" {
		t.Errorf("CollectionStatusSkipped = %q, want %q", string(CollectionStatusSkipped), "SKIPPED")
	}
}

func TestIngestionStateConstants(t *testing.T) {
	if string(IngestionStateIdle) != "IDLE" {
		t.Errorf("IngestionStateIdle = %q, want %q", string(IngestionStateIdle), "IDLE")
	}
	if string(IngestionStateRunning) != "RUNNING" {
		t.Errorf("IngestionStateRunning = %q, want %q", string(IngestionStateRunning), "RUNNING")
	}
	if string(IngestionStatePaused) != "PAUSED" {
		t.Errorf("IngestionStatePaused = %q, want %q", string(IngestionStatePaused), "PAUSED")
	}
}

func TestMetadataEndpointModel(t *testing.T) {
	ep := MetadataEndpoint{
		ID:   "test-id",
		Name: "Test Endpoint",
		Verb: "GET",
		URL:  "https://example.com",
	}

	if ep.ID != "test-id" {
		t.Errorf("ID = %q, want %q", ep.ID, "test-id")
	}
	if ep.Name != "Test Endpoint" {
		t.Errorf("Name = %q, want %q", ep.Name, "Test Endpoint")
	}
}

func TestMetadataRecordModel(t *testing.T) {
	rec := MetadataRecord{
		ID:        "rec-123",
		Domain:    "test.domain",
		ProjectID: "proj-123",
		Labels:    []string{"label1", "label2"},
		Payload:   []byte(`{"key": "value"}`),
	}

	if rec.ID != "rec-123" {
		t.Errorf("ID = %q, want %q", rec.ID, "rec-123")
	}
	if len(rec.Labels) != 2 {
		t.Errorf("len(Labels) = %d, want %d", len(rec.Labels), 2)
	}
}
