package onedrive

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

const (
	graphAPIBase = "https://graph.microsoft.com/v1.0"
	tokenURL     = "https://login.microsoftonline.com/%s/oauth2/v2.0/token"
)

// OneDrive implements the OneDrive connector using Microsoft Graph API.
type OneDrive struct {
	Config      *Config
	httpClient  *http.Client
	accessToken string
	tokenExpiry time.Time
	tokenMu     sync.RWMutex
}

// Ensure interface compliance
var _ endpoint.SourceEndpoint = (*OneDrive)(nil)

// New creates a new OneDrive connector.
func New(config map[string]any) (*OneDrive, error) {
	cfg, err := ParseConfig(config)
	if err != nil {
		return nil, err
	}

	return &OneDrive{
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
func (o *OneDrive) ID() string {
	return "cloud.onedrive"
}

// Close releases resources.
func (o *OneDrive) Close() error {
	return nil
}

// GetDescriptor returns the connector descriptor.
func (o *OneDrive) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          "cloud.onedrive",
		Family:      "cloud",
		Title:       "OneDrive",
		Vendor:      "Microsoft",
		Description: "Microsoft OneDrive via Graph API with OAuth 2.0",
		Categories:  []string{"storage", "cloud", "microsoft"},
		Protocols:   []string{"REST", "HTTPS", "OAuth2"},
		DocsURL:     "https://docs.microsoft.com/en-us/graph/api/resources/onedrive",
		Fields: []*endpoint.FieldDescriptor{
			{Key: "clientId", Label: "Client ID", ValueType: "string", Required: true, Semantic: "GENERIC", Placeholder: "your-azure-app-client-id", Description: "Azure App Client ID"},
			{Key: "clientSecret", Label: "Client Secret", ValueType: "password", Required: false, Sensitive: true, Semantic: "PASSWORD", Description: "Azure App Client Secret"},
			{Key: "tenantId", Label: "Tenant ID", ValueType: "string", Required: false, Semantic: "GENERIC", Placeholder: "common", Description: "Azure Tenant ID (default: common)"},
			{Key: "refreshToken", Label: "Refresh Token", ValueType: "password", Required: true, Sensitive: true, Semantic: "PASSWORD", Description: "OAuth 2.0 refresh token"},
			{Key: "driveId", Label: "Drive ID", ValueType: "string", Required: false, Semantic: "GENERIC", Description: "Specific drive ID (optional)"},
			{Key: "rootPath", Label: "Root Path", ValueType: "string", Required: false, Semantic: "FILE_PATH", Description: "Root folder path (default: /)"},
		},
	}
}

// GetCapabilities returns connector capabilities.
func (o *OneDrive) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: true, // Delta tokens via /delta endpoint
		SupportsCountProbe:  false,
		SupportsPreview:     true,
		SupportsMetadata:    true,
	}
}

// ValidateConfig tests connection to OneDrive.
func (o *OneDrive) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	// Try to get access token
	if err := o.ensureAccessToken(ctx); err != nil {
		return &endpoint.ValidationResult{
			Valid:   false,
			Message: fmt.Sprintf("Authentication failed: %v", err),
		}, nil
	}

	// Try to get drive info
	driveInfo, err := o.getDriveInfo(ctx)
	if err != nil {
		return &endpoint.ValidationResult{
			Valid:   false,
			Message: fmt.Sprintf("Failed to access drive: %v", err),
		}, nil
	}

	return &endpoint.ValidationResult{
		Valid:   true,
		Message: fmt.Sprintf("Connected to drive: %s", driveInfo),
	}, nil
}

// =============================================================================
// SOURCE ENDPOINT
// =============================================================================

// ListDatasets returns available OneDrive datasets.
func (o *OneDrive) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	return DatasetDefinitions, nil
}

// GetSchema returns the schema for a dataset.
func (o *OneDrive) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	schema := GetSchemaByDatasetID(datasetID)
	if schema == nil {
		return nil, fmt.Errorf("unknown dataset: %s", datasetID)
	}
	return schema, nil
}

// Read reads records from a dataset.
func (o *OneDrive) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if err := o.ensureAccessToken(ctx); err != nil {
		return nil, err
	}

	switch req.DatasetID {
	case "onedrive.file":
		return o.readItems(ctx, req, false)
	case "onedrive.folder":
		return o.readItems(ctx, req, true)
	default:
		return nil, fmt.Errorf("unknown dataset: %s", req.DatasetID)
	}
}

// =============================================================================
// OAUTH TOKEN MANAGEMENT
// =============================================================================

func (o *OneDrive) ensureAccessToken(ctx context.Context) error {
	o.tokenMu.RLock()
	if o.accessToken != "" && time.Now().Before(o.tokenExpiry) {
		o.tokenMu.RUnlock()
		return nil
	}
	o.tokenMu.RUnlock()

	o.tokenMu.Lock()
	defer o.tokenMu.Unlock()

	// Double-check after acquiring write lock
	if o.accessToken != "" && time.Now().Before(o.tokenExpiry) {
		return nil
	}

	return o.refreshAccessToken(ctx)
}

func (o *OneDrive) refreshAccessToken(ctx context.Context) error {
	tokenEndpoint := fmt.Sprintf(tokenURL, o.Config.TenantID)

	data := url.Values{}
	data.Set("client_id", o.Config.ClientID)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", o.Config.RefreshToken)
	data.Set("scope", "https://graph.microsoft.com/.default offline_access")

	if o.Config.ClientSecret != "" {
		data.Set("client_secret", o.Config.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("token refresh failed: %s", string(body))
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return err
	}

	o.accessToken = tokenResp.AccessToken
	o.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn-60) * time.Second)

	// Update refresh token if a new one was provided
	if tokenResp.RefreshToken != "" {
		o.Config.RefreshToken = tokenResp.RefreshToken
	}

	return nil
}

// =============================================================================
// GRAPH API OPERATIONS
// =============================================================================

func (o *OneDrive) graphRequest(ctx context.Context, path string) ([]byte, error) {
	reqURL := graphAPIBase + path

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+o.accessToken)

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Graph API error %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

func (o *OneDrive) getDriveInfo(ctx context.Context) (string, error) {
	path := "/me/drive"
	if o.Config.DriveID != "" {
		path = "/drives/" + o.Config.DriveID
	}

	body, err := o.graphRequest(ctx, path)
	if err != nil {
		return "", err
	}

	var result struct {
		Name  string `json:"name"`
		Owner struct {
			User struct {
				DisplayName string `json:"displayName"`
			} `json:"user"`
		} `json:"owner"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	return result.Name, nil
}

func (o *OneDrive) listChildren(ctx context.Context, itemPath string) (*ListResponse, error) {
	var apiPath string
	if o.Config.DriveID != "" {
		if itemPath == "/" || itemPath == "" {
			apiPath = fmt.Sprintf("/drives/%s/root/children", o.Config.DriveID)
		} else {
			apiPath = fmt.Sprintf("/drives/%s/root:%s:/children", o.Config.DriveID, itemPath)
		}
	} else {
		if itemPath == "/" || itemPath == "" {
			apiPath = "/me/drive/root/children"
		} else {
			apiPath = fmt.Sprintf("/me/drive/root:%s:/children", itemPath)
		}
	}

	body, err := o.graphRequest(ctx, apiPath)
	if err != nil {
		return nil, err
	}

	var result ListResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// =============================================================================
// READ HELPERS
// =============================================================================

func (o *OneDrive) readItems(ctx context.Context, req *endpoint.ReadRequest, foldersOnly bool) (endpoint.Iterator[endpoint.Record], error) {
	return &onedriveIterator{
		onedrive:    o,
		ctx:         ctx,
		foldersOnly: foldersOnly,
		queue:       []string{o.Config.RootPath},
		records:     make([]endpoint.Record, 0),
		index:       0,
		limit:       req.Limit,
		count:       0,
	}, nil
}

// onedriveIterator iterates over OneDrive files/folders.
type onedriveIterator struct {
	onedrive    *OneDrive
	ctx         context.Context
	foldersOnly bool
	queue       []string // folders to process
	records     []endpoint.Record
	index       int
	current     endpoint.Record
	err         error
	limit       int64
	count       int64
}

func (it *onedriveIterator) Next() bool {
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

	// Process next folder in queue
	for len(it.queue) > 0 {
		path := it.queue[0]
		it.queue = it.queue[1:]

		// Ensure token is valid
		if err := it.onedrive.ensureAccessToken(it.ctx); err != nil {
			it.err = err
			return false
		}

		items, err := it.onedrive.listChildren(it.ctx, path)
		if err != nil {
			it.err = err
			return false
		}

		for _, item := range items.Value {
			itemPath := path + "/" + item.Name
			if path == "/" {
				itemPath = "/" + item.Name
			}

			if item.Folder != nil {
				it.queue = append(it.queue, itemPath)
				if it.foldersOnly {
					it.records = append(it.records, it.buildFolderRecord(item, itemPath))
				}
			} else if !it.foldersOnly && item.File != nil {
				it.records = append(it.records, it.buildFileRecord(item, itemPath))
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

func (it *onedriveIterator) Value() endpoint.Record {
	return it.current
}

func (it *onedriveIterator) Err() error {
	return it.err
}

func (it *onedriveIterator) Close() error {
	return nil
}

func (it *onedriveIterator) buildFileRecord(item DriveItem, path string) endpoint.Record {
	mimeType := ""
	if item.File != nil {
		mimeType = item.File.MimeType
	}

	createdBy := ""
	if item.CreatedBy != nil && item.CreatedBy.User != nil {
		createdBy = item.CreatedBy.User.DisplayName
	}

	modifiedBy := ""
	if item.ModifiedBy != nil && item.ModifiedBy.User != nil {
		modifiedBy = item.ModifiedBy.User.DisplayName
	}

	return endpoint.Record{
		"id":           item.ID,
		"name":         item.Name,
		"path":         path,
		"size":         item.Size,
		"mimeType":     mimeType,
		"createdTime":  item.CreatedDateTime,
		"modifiedTime": item.ModifiedDateTime,
		"webUrl":       item.WebURL,
		"createdBy":    createdBy,
		"modifiedBy":   modifiedBy,
	}
}

func (it *onedriveIterator) buildFolderRecord(item DriveItem, path string) endpoint.Record {
	childCount := 0
	if item.Folder != nil {
		childCount = item.Folder.ChildCount
	}

	return endpoint.Record{
		"id":           item.ID,
		"name":         item.Name,
		"path":         path,
		"childCount":   childCount,
		"createdTime":  item.CreatedDateTime,
		"modifiedTime": item.ModifiedDateTime,
		"webUrl":       item.WebURL,
	}
}

// =============================================================================
// SLICE CAPABLE - Incremental Delta Support
// =============================================================================

// GetCheckpoint returns the current checkpoint for a dataset.
func (o *OneDrive) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	// For full sync, we'd normally fetch from metadata store
	// For now, return empty checkpoint indicating "start fresh"
	return &endpoint.Checkpoint{
		Watermark: "",
		Metadata: map[string]any{
			"deltaLink": "",
		},
	}, nil
}

// PlanSlices creates an ingestion plan using delta tokens if available.
func (o *OneDrive) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	deltaLink := ""
	if req.Checkpoint != nil && req.Checkpoint.Metadata != nil {
		if dl, ok := req.Checkpoint.Metadata["deltaLink"].(string); ok {
			deltaLink = dl
		}
	}

	return &endpoint.IngestionPlan{
		DatasetID: req.DatasetID,
		Strategy:  req.Strategy,
		Slices: []*endpoint.IngestionSlice{
			{
				SliceID:  "delta",
				Sequence: 0,
				Lower:    deltaLink, // deltaLink stored in Lower for now
				Upper:    "",
			},
		},
	}, nil
}

// ReadSlice reads a slice of data using delta query.
func (o *OneDrive) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if err := o.ensureAccessToken(ctx); err != nil {
		return nil, err
	}

	deltaLink := ""
	if req.Slice != nil {
		deltaLink = req.Slice.Lower
	}

	foldersOnly := req.DatasetID == "onedrive.folder"
	return o.readDelta(ctx, deltaLink, foldersOnly)
}

// readDelta fetches items using the delta endpoint.
func (o *OneDrive) readDelta(ctx context.Context, deltaLink string, foldersOnly bool) (endpoint.Iterator[endpoint.Record], error) {
	return &deltaIterator{
		onedrive:    o,
		ctx:         ctx,
		foldersOnly: foldersOnly,
		nextLink:    deltaLink,
		items:       make([]DeltaDriveItem, 0),
	}, nil
}

// fetchDelta calls the Graph API delta endpoint.
func (o *OneDrive) fetchDelta(ctx context.Context, link string) (*DeltaResponse, error) {
	var apiPath string
	if link != "" {
		// Use the provided link directly (nextLink or deltaLink)
		apiPath = link
	} else {
		// Initial delta request
		if o.Config.DriveID != "" {
			apiPath = fmt.Sprintf("/drives/%s/root/delta", o.Config.DriveID)
		} else {
			apiPath = "/me/drive/root/delta"
		}
	}

	// For external URLs (nextLink/deltaLink), use full URL
	var body []byte
	var err error
	if strings.HasPrefix(apiPath, "http") {
		body, err = o.graphRequestURL(ctx, apiPath)
	} else {
		body, err = o.graphRequest(ctx, apiPath)
	}
	if err != nil {
		return nil, err
	}

	var resp DeltaResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}

	return &resp, nil
}

// graphRequestURL makes a request to a full URL (for nextLink/deltaLink).
func (o *OneDrive) graphRequestURL(ctx context.Context, fullURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+o.accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusGone {
		// Token expired, need full resync
		return nil, fmt.Errorf("delta token expired (HTTP 410), full resync required")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("graph API error: %s", string(body))
	}

	return body, nil
}

// =============================================================================
// DELTA ITERATOR
// =============================================================================

type deltaIterator struct {
	onedrive    *OneDrive
	ctx         context.Context
	foldersOnly bool
	nextLink    string
	deltaLink   string // Final deltaLink for checkpoint
	items       []DeltaDriveItem
	index       int
	current     endpoint.Record
	err         error
	done        bool
}

func (it *deltaIterator) Next() bool {
	for {
		// Check buffered items
		if it.index < len(it.items) {
			item := it.items[it.index]
			it.index++

			// Skip deleted items (just record them for now)
			if item.Deleted != nil {
				continue
			}

			// Apply folder filter
			isFolder := item.Folder != nil
			if it.foldersOnly && !isFolder {
				continue
			}
			if !it.foldersOnly && isFolder {
				continue
			}

			// Build record
			if isFolder {
				it.current = it.buildFolderRecord(item)
			} else {
				it.current = it.buildFileRecord(item)
			}
			return true
		}

		if it.done {
			return false
		}

		// Fetch more items
		resp, err := it.onedrive.fetchDelta(it.ctx, it.nextLink)
		if err != nil {
			it.err = err
			return false
		}

		it.items = resp.Value
		it.index = 0

		if resp.NextLink != "" {
			it.nextLink = resp.NextLink
		} else if resp.DeltaLink != "" {
			it.deltaLink = resp.DeltaLink
			it.done = true
		} else {
			it.done = true
		}

		if len(it.items) == 0 && it.done {
			return false
		}
	}
}

func (it *deltaIterator) Value() endpoint.Record {
	return it.current
}

func (it *deltaIterator) Err() error {
	return it.err
}

func (it *deltaIterator) Close() error {
	return nil
}

// DeltaLink returns the final delta link for checkpoint storage.
func (it *deltaIterator) DeltaLink() string {
	return it.deltaLink
}

func (it *deltaIterator) buildFileRecord(item DeltaDriveItem) endpoint.Record {
	mimeType := ""
	if item.File != nil {
		mimeType = item.File.MimeType
	}

	createdBy := ""
	if item.CreatedBy != nil && item.CreatedBy.User != nil {
		createdBy = item.CreatedBy.User.DisplayName
	}

	modifiedBy := ""
	if item.ModifiedBy != nil && item.ModifiedBy.User != nil {
		modifiedBy = item.ModifiedBy.User.DisplayName
	}

	return endpoint.Record{
		"id":           item.ID,
		"name":         item.Name,
		"path":         item.getPath(),
		"size":         item.Size,
		"mimeType":     mimeType,
		"createdTime":  item.CreatedDateTime,
		"modifiedTime": item.ModifiedDateTime,
		"webUrl":       item.WebURL,
		"createdBy":    createdBy,
		"modifiedBy":   modifiedBy,
	}
}

func (it *deltaIterator) buildFolderRecord(item DeltaDriveItem) endpoint.Record {
	childCount := 0
	if item.Folder != nil {
		childCount = item.Folder.ChildCount
	}

	return endpoint.Record{
		"id":           item.ID,
		"name":         item.Name,
		"path":         item.getPath(),
		"childCount":   childCount,
		"createdTime":  item.CreatedDateTime,
		"modifiedTime": item.ModifiedDateTime,
		"webUrl":       item.WebURL,
	}
}

// Helper to get path from parent reference
func (item *DeltaDriveItem) getPath() string {
	if item.ParentReference != nil && item.ParentReference.Path != "" {
		return item.ParentReference.Path + "/" + item.Name
	}
	return "/" + item.Name
}

