package activities

import (
	"testing"
)

func TestMergeCheckpoints_FlattensNesting(t *testing.T) {
	// Reproducer for nested cursor issue
	nestedCursor := map[string]any{
		"cursor": map[string]any{
			"position": "100",
		},
	}
	
	// Input checkpoint that wraps the cursor in another "cursor" field
	input := map[string]any{
		"runId": "run-1",
		"cursor": nestedCursor, 
	}
	
	// The flatten logic should lift {position: 100} to "cursor"
	res := mergeCheckpoints(input, nil)
	
	cursor, ok := res["cursor"].(map[string]any)
	if !ok {
		t.Fatalf("expected cursor to be a map, got %T", res["cursor"])
	}
	
	// Check if we still have nested "cursor"
	if _, nested := cursor["cursor"]; nested {
		t.Error("Merge failed to flatten nested cursor")
	}
	
	if pos, ok := cursor["position"].(string); !ok || pos != "100" {
		t.Errorf("Expected position 100, got %v", cursor["position"])
	}
}

func TestMergeCheckpoints_DeeplyNested(t *testing.T) {
	// Simulate the 34-level nesting from the real checkpoint
	deeplyNested := map[string]any{
		"watermark": "2025-12-15T12:36:06Z",
		"lastRunAt": "2025-12-15T12:36:11Z",
		"recordCount": 50,
	}
	
	// Create 34 levels of nesting
	for i := 0; i < 34; i++ {
		deeplyNested = map[string]any{
			"cursor": deeplyNested,
			"lastRunAt": "2025-12-15",
			"recordCount": 50,
		}
	}
	
	input := map[string]any{
		"cursor": deeplyNested,
	}
	
	res := mergeCheckpoints(input, nil)
	
	// The cursor should now be the innermost value (the watermark string)
	cursor := res["cursor"]
	if cursor == nil {
		t.Fatal("expected cursor to be non-nil after flattening")
	}
	
	// The innermost cursor should be the watermark string
	if wm, ok := cursor.(string); ok {
		if wm != "2025-12-15T12:36:06Z" {
			t.Errorf("expected watermark '2025-12-15T12:36:06Z', got %v", wm)
		}
	} else if cursorMap, ok := cursor.(map[string]any); ok {
		// If it's a map, verify no more nested cursors
		if _, nested := cursorMap["cursor"]; nested {
			t.Error("still have nested cursor after flattening")
		}
	} else {
		t.Logf("cursor type after flattening: %T = %v", cursor, cursor)
	}
}

func TestMergeCheckpoints_Regular(t *testing.T) {
	input := map[string]any{
		"cursor": "simple-cursor",
		"runId": "run-1",
	}
	res := mergeCheckpoints(input, nil)
	
	if res["cursor"] != "simple-cursor" {
		t.Errorf("Expected cursor 'simple-cursor', got %v", res["cursor"])
	}
	if res["runId"] != "run-1" {
		t.Errorf("Expected runId 'run-1', got %v", res["runId"])
	}
}

func TestFlattenCursor_Watermark(t *testing.T) {
	// Test that watermark is extracted from a map with no cursor key
	input := map[string]any{
		"watermark": "2025-12-15T12:00:00Z",
		"lastRunAt": "2025-12-15T12:00:00Z",
	}
	
	result := flattenCursor(input)
	
	if result != "2025-12-15T12:00:00Z" {
		t.Errorf("expected watermark to be extracted, got %v", result)
	}
}

func TestNormalizeCheckpointForRead_DeeplyNested(t *testing.T) {
	// Simulate the 35-level nesting from the real legacy checkpoint
	innermost := map[string]any{
		"watermark":   "2025-12-15T12:36:06Z",
		"lastRunAt":   "2025-12-15T12:36:11Z",
		"recordCount": 50,
		"dataMode":    "raw",
	}
	
	// Create 35 levels of nesting (like the real checkpoint.json)
	nested := innermost
	for i := 0; i < 35; i++ {
		nested = map[string]any{
			"cursor":      nested,
			"lastRunAt":   "2025-12-15",
			"recordCount": 50,
		}
	}
	
	// This is what the activity receives from TypeScript
	input := map[string]any{
		"cursor":    nested,
		"lastRunId": "legacy-run",
	}
	
	// Normalize should extract the watermark
	result := normalizeCheckpointForRead(input)
	
	wm, ok := result["watermark"].(string)
	if !ok || wm == "" {
		t.Errorf("expected watermark to be extracted from deeply nested checkpoint, got %v", result)
	}
	
	if wm != "2025-12-15T12:36:06Z" {
		t.Errorf("expected watermark '2025-12-15T12:36:06Z', got %v", wm)
	}
}

func TestNormalizeCheckpointForRead_AlreadyFlat(t *testing.T) {
	// A properly formatted checkpoint should be returned as-is
	input := map[string]any{
		"watermark":   "2025-12-22T20:00:00Z",
		"lastRunId":   "run-123",
		"recordCount": 100,
	}
	
	result := normalizeCheckpointForRead(input)
	
	if result["watermark"] != "2025-12-22T20:00:00Z" {
		t.Errorf("expected watermark to be preserved, got %v", result["watermark"])
	}
}
