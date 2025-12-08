package hdfs

import (
	"fmt"
	"strings"
)

// Config holds HDFS WebHDFS connection configuration.
type Config struct {
	NameNodeURL string // WebHDFS URL (e.g., http://namenode:9870)
	User        string // HDFS user for operations
	BasePath    string // Optional base path for all operations
}

// ParseConfig extracts configuration from a map.
func ParseConfig(m map[string]any) (*Config, error) {
	cfg := &Config{
		NameNodeURL: getString(m, "namenodeUrl", getString(m, "namenode_url", "")),
		User:        getString(m, "user", "hdfs"),
		BasePath:    getString(m, "basePath", getString(m, "base_path", "/")),
	}

	if cfg.NameNodeURL == "" {
		return nil, fmt.Errorf("namenodeUrl is required")
	}

	// Normalize base path
	if !strings.HasPrefix(cfg.BasePath, "/") {
		cfg.BasePath = "/" + cfg.BasePath
	}

	return cfg, nil
}

// WebHDFS operation constants
const (
	OpListStatus    = "LISTSTATUS"
	OpGetFileStatus = "GETFILESTATUS"
	OpOpen          = "OPEN"
	OpGetContentSum = "GETCONTENTSUMMARY"
)

// FileStatus represents HDFS file/directory metadata.
type FileStatus struct {
	AccessTime       int64  `json:"accessTime"`
	BlockSize        int64  `json:"blockSize"`
	Group            string `json:"group"`
	Length           int64  `json:"length"`
	ModificationTime int64  `json:"modificationTime"`
	Owner            string `json:"owner"`
	PathSuffix       string `json:"pathSuffix"`
	Permission       string `json:"permission"`
	Replication      int    `json:"replication"`
	Type             string `json:"type"` // FILE or DIRECTORY
}

// ListStatusResponse is the WebHDFS response for LISTSTATUS.
type ListStatusResponse struct {
	FileStatuses struct {
		FileStatus []FileStatus `json:"FileStatus"`
	} `json:"FileStatuses"`
}

// FileStatusResponse is the WebHDFS response for GETFILESTATUS.
type FileStatusResponse struct {
	FileStatus FileStatus `json:"FileStatus"`
}

// ContentSummary represents HDFS content summary.
type ContentSummary struct {
	DirectoryCount int64 `json:"directoryCount"`
	FileCount      int64 `json:"fileCount"`
	Length         int64 `json:"length"`
	Quota          int64 `json:"quota"`
	SpaceConsumed  int64 `json:"spaceConsumed"`
	SpaceQuota     int64 `json:"spaceQuota"`
}

// ContentSummaryResponse is the WebHDFS response for GETCONTENTSUMMARY.
type ContentSummaryResponse struct {
	ContentSummary ContentSummary `json:"ContentSummary"`
}

// --- Helper functions ---

func getString(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}
