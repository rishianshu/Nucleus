package hdfs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// HDFS implements the HDFS connector using WebHDFS REST API.
type HDFS struct {
	Config     *Config
	httpClient *http.Client
}

// Ensure interface compliance
var _ endpoint.SourceEndpoint = (*HDFS)(nil)

// Note: SliceCapable requires CountBetween which we don't implement for HDFS

// New creates a new HDFS connector.
func New(config map[string]any) (*HDFS, error) {
	cfg, err := ParseConfig(config)
	if err != nil {
		return nil, err
	}

	return &HDFS{
		Config: cfg,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// =============================================================================
// ENDPOINT INTERFACE
// =============================================================================

// ID returns the connector template ID.
func (h *HDFS) ID() string {
	return "hdfs.webhdfs"
}

// Close releases resources.
func (h *HDFS) Close() error {
	return nil
}

// GetDescriptor returns the connector descriptor.
func (h *HDFS) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          "hdfs.webhdfs",
		Family:      "hdfs",
		Title:       "HDFS (WebHDFS)",
		Vendor:      "Apache",
		Description: "Hadoop Distributed File System via WebHDFS REST API",
		Categories:  []string{"storage", "data-lake", "big-data"},
		Protocols:   []string{"REST", "HTTP"},
		DefaultPort: 9870,
		DocsURL:     "https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/WebHDFS.html",
		Fields: []*endpoint.FieldDescriptor{
			{Key: "namenodeUrl", Label: "NameNode URL", ValueType: "string", Required: true, Semantic: "HOST", Placeholder: "http://namenode:9870", Description: "WebHDFS URL"},
			{Key: "user", Label: "User", ValueType: "string", Required: false, Semantic: "GENERIC", Description: "HDFS user (default: hdfs)"},
			{Key: "basePath", Label: "Base Path", ValueType: "string", Required: false, Semantic: "FILE_PATH", Description: "Base path for operations (default: /)"},
		},
	}
}

// GetCapabilities returns connector capabilities.
func (h *HDFS) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: false,
		SupportsCountProbe:  false,
		SupportsPreview:     true,
		SupportsMetadata:    true,
	}
}

// ValidateConfig tests connection to HDFS.
func (h *HDFS) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	// Try to get file status of base path
	_, err := h.getFileStatus(ctx, h.Config.BasePath)
	if err != nil {
		return &endpoint.ValidationResult{
			Valid:   false,
			Message: fmt.Sprintf("Failed to connect: %v", err),
		}, nil
	}

	return &endpoint.ValidationResult{
		Valid:   true,
		Message: fmt.Sprintf("Connected to %s", h.Config.NameNodeURL),
	}, nil
}

// =============================================================================
// SOURCE ENDPOINT
// =============================================================================

// ListDatasets returns available HDFS datasets.
func (h *HDFS) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	return DatasetDefinitions, nil
}

// GetSchema returns the schema for a dataset.
func (h *HDFS) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	schema := GetSchemaByDatasetID(datasetID)
	if schema == nil {
		return nil, fmt.Errorf("unknown dataset: %s", datasetID)
	}
	return schema, nil
}

// Read reads records from a dataset.
func (h *HDFS) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	switch req.DatasetID {
	case "hdfs.file":
		return h.readFiles(ctx, req)
	case "hdfs.directory":
		return h.readDirectories(ctx, req)
	default:
		return nil, fmt.Errorf("unknown dataset: %s", req.DatasetID)
	}
}

// =============================================================================
// WEBHDFS OPERATIONS
// =============================================================================

func (h *HDFS) buildURL(path, op string, params map[string]string) string {
	u, _ := url.Parse(h.Config.NameNodeURL)
	u.Path = "/webhdfs/v1" + path

	q := u.Query()
	q.Set("op", op)
	q.Set("user.name", h.Config.User)
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	return u.String()
}

func (h *HDFS) listStatus(ctx context.Context, path string) ([]FileStatus, error) {
	reqURL := h.buildURL(path, OpListStatus, nil)

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("WebHDFS error %d: %s", resp.StatusCode, string(body))
	}

	var result ListStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.FileStatuses.FileStatus, nil
}

func (h *HDFS) getFileStatus(ctx context.Context, path string) (*FileStatus, error) {
	reqURL := h.buildURL(path, OpGetFileStatus, nil)

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("WebHDFS error %d: %s", resp.StatusCode, string(body))
	}

	var result FileStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result.FileStatus, nil
}

// =============================================================================
// READ HELPERS
// =============================================================================

func (h *HDFS) readFiles(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return h.readFilesRecursive(ctx, h.Config.BasePath, "hdfs.file", req.Limit)
}

func (h *HDFS) readDirectories(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return h.readFilesRecursive(ctx, h.Config.BasePath, "hdfs.directory", req.Limit)
}

func (h *HDFS) readFilesRecursive(ctx context.Context, basePath, datasetID string, limit int64) (endpoint.Iterator[endpoint.Record], error) {
	return &hdfsIterator{
		hdfs:      h,
		ctx:       ctx,
		datasetID: datasetID,
		queue:     []string{basePath},
		records:   make([]endpoint.Record, 0),
		index:     0,
		limit:     limit,
		count:     0,
	}, nil
}

// hdfsIterator iterates over HDFS files/directories.
type hdfsIterator struct {
	hdfs      *HDFS
	ctx       context.Context
	datasetID string
	queue     []string // directories to process
	records   []endpoint.Record
	index     int
	current   endpoint.Record
	err       error
	limit     int64
	count     int64
}

func (it *hdfsIterator) Next() bool {
	// Check limit
	if it.limit > 0 && it.count >= it.limit {
		return false
	}

	// Return buffered records first
	if it.index < len(it.records) {
		it.current = it.records[it.index]
		it.index++
		it.count++
		return true
	}

	// Reset buffer
	it.records = it.records[:0]
	it.index = 0

	// Process next directory in queue
	for len(it.queue) > 0 {
		path := it.queue[0]
		it.queue = it.queue[1:]

		statuses, err := it.hdfs.listStatus(it.ctx, path)
		if err != nil {
			it.err = err
			return false
		}

		for _, status := range statuses {
			fullPath := path + "/" + status.PathSuffix
			if path == "/" {
				fullPath = "/" + status.PathSuffix
			}

			if status.Type == "DIRECTORY" {
				it.queue = append(it.queue, fullPath)

				if it.datasetID == "hdfs.directory" {
					it.records = append(it.records, it.buildDirectoryRecord(fullPath, status))
				}
			} else if it.datasetID == "hdfs.file" {
				it.records = append(it.records, it.buildFileRecord(fullPath, status))
			}
		}

		// Return first record if available
		if it.index < len(it.records) {
			it.current = it.records[it.index]
			it.index++
			it.count++
			return true
		}
	}

	return false
}

func (it *hdfsIterator) Value() endpoint.Record {
	return it.current
}

func (it *hdfsIterator) Err() error {
	return it.err
}

func (it *hdfsIterator) Close() error {
	return nil
}

func (it *hdfsIterator) buildFileRecord(path string, status FileStatus) endpoint.Record {
	parts := strings.Split(path, "/")
	name := parts[len(parts)-1]

	return endpoint.Record{
		"path":             path,
		"name":             name,
		"size":             status.Length,
		"modificationTime": time.UnixMilli(status.ModificationTime),
		"accessTime":       time.UnixMilli(status.AccessTime),
		"owner":            status.Owner,
		"group":            status.Group,
		"permission":       status.Permission,
		"replication":      status.Replication,
		"blockSize":        status.BlockSize,
	}
}

func (it *hdfsIterator) buildDirectoryRecord(path string, status FileStatus) endpoint.Record {
	parts := strings.Split(path, "/")
	name := parts[len(parts)-1]

	return endpoint.Record{
		"path":             path,
		"name":             name,
		"modificationTime": time.UnixMilli(status.ModificationTime),
		"owner":            status.Owner,
		"group":            status.Group,
		"permission":       status.Permission,
	}
}
