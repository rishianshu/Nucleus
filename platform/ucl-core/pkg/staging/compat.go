package staging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// Handle describes a staged payload reference.
type Handle struct {
	Path       string `json:"path"`
	ProviderID string `json:"providerId,omitempty"`
	StageRef   string `json:"stageRef,omitempty"`
	BatchRef   string `json:"batchRef,omitempty"`
}

// StageJSON writes any JSON-serializable value to a temp file.
func StageJSON(value any, prefix string) (string, error) {
	if value == nil {
		return "", nil
	}

	data, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("marshal staging payload: %w", err)
	}

	filename := fmt.Sprintf("%s-%s.json", prefix, uuid.New().String())
	path := filepath.Join(os.TempDir(), filename)

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write staging file: %w", err)
	}

	return path, nil
}

// StageRecords stages records to a temp file and returns a lightweight handle.
// This maintains compatibility for preview flows that expect a file path.
func StageRecords(records any, providerID string) (*Handle, error) {
	if records == nil {
		return nil, nil
	}

	data, err := json.Marshal(records)
	if err != nil {
		return nil, fmt.Errorf("marshal records: %w", err)
	}

	filename := fmt.Sprintf("ucl-records-%s.json", uuid.New().String())
	path := filepath.Join(os.TempDir(), filename)

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return nil, fmt.Errorf("write staging file: %w", err)
	}

	if providerID == "" {
		providerID = ProviderMemory
	}

	return &Handle{
		Path:       path,
		ProviderID: providerID,
		StageRef:   "",
	}, nil
}

// Cleanup removes a staging artifact (best-effort).
func Cleanup(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
