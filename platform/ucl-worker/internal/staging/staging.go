// Package staging provides file staging for activity outputs.
package staging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// Handle represents a staged file.
type Handle struct {
	Path       string `json:"path"`
	ProviderID string `json:"providerId,omitempty"`
}

// DefaultProvider is the default staging provider.
const DefaultProvider = "in_memory"

// StageRecords writes records to a JSON file and returns a handle.
func StageRecords(records any, providerID string) (*Handle, error) {
	if records == nil {
		return nil, nil
	}

	data, err := json.Marshal(records)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal records: %w", err)
	}

	// Generate temp file path
	filename := fmt.Sprintf("ucl-records-%s.json", uuid.New().String())
	path := filepath.Join(os.TempDir(), filename)

	if err := os.WriteFile(path, data, 0644); err != nil {
		return nil, fmt.Errorf("failed to write staging file: %w", err)
	}

	provider := providerID
	if provider == "" {
		provider = DefaultProvider
	}

	return &Handle{
		Path:       path,
		ProviderID: provider,
	}, nil
}

// StageJSON writes any JSON-serializable value to a staging file.
func StageJSON(value any, prefix string) (string, error) {
	if value == nil {
		return "", nil
	}

	data, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("failed to marshal value: %w", err)
	}

	filename := fmt.Sprintf("%s-%s.json", prefix, uuid.New().String())
	path := filepath.Join(os.TempDir(), filename)

	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write staging file: %w", err)
	}

	return path, nil
}

// LoadRecords reads JSON records from a staging file.
func LoadRecords(path string) ([]map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read staging file: %w", err)
	}

	var records []map[string]any
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("failed to unmarshal records: %w", err)
	}

	return records, nil
}

// Cleanup removes a staging file.
func Cleanup(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}

// MaxPayloadBytes is the threshold for staging large outputs.
const MaxPayloadBytes = 500_000
