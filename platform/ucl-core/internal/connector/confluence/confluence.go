package confluence

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/internal/connector/http"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Confluence implements the Confluence Cloud connector.
type Confluence struct {
	*http.Base
	config *Config
}

// New creates a new Confluence connector.
func New(cfg *Config) (*Confluence, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	httpConfig := &http.ClientConfig{
		BaseURL: cfg.BaseURL,
		Auth:    http.AtlassianAuth{Email: cfg.Email, APIToken: cfg.APIToken},
	}

	return &Confluence{
		Base:   http.NewBase("http.confluence", "Confluence", "Atlassian", httpConfig),
		config: cfg,
	}, nil
}

// --- Endpoint Interface ---

// GetDescriptor returns Confluence endpoint metadata.
func (c *Confluence) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          "http.confluence",
		Family:      "http",
		Title:       "Confluence Cloud",
		Vendor:      "Atlassian",
		Description: "Confluence Cloud REST API connector for spaces, pages, and attachments",
		Categories:  []string{"documentation", "wiki", "collaboration"},
		Protocols:   []string{"REST", "HTTPS"},
		DocsURL:     "https://developer.atlassian.com/cloud/confluence/rest/",
		Fields: []*endpoint.FieldDescriptor{
			{Key: "baseUrl", Label: "Base URL", ValueType: "string", Required: true, Semantic: "HOST"},
			{Key: "email", Label: "Email", ValueType: "string", Required: true},
			{Key: "apiToken", Label: "API Token", ValueType: "password", Required: true, Sensitive: true},
			{Key: "spaces", Label: "Spaces", ValueType: "string", Description: "Comma-separated space keys (optional)"},
		},
	}
}

// GetCapabilities returns Confluence capabilities.
func (c *Confluence) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: true, // Uses expand=history.lastUpdated with client-side filtering
		SupportsMetadata:    true,
		SupportsPreview:     true,
	}
}

// ValidateConfig validates the Confluence connection.
func (c *Confluence) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	// Make a test request to verify credentials
	resp, err := c.Client.Get(ctx, "/wiki/rest/api/user/current", nil)
	if err != nil {
		return &endpoint.ValidationResult{
			Valid:   false,
			Message: fmt.Sprintf("Connection failed: %v", err),
		}, nil
	}

	var user CurrentUser
	if err := resp.JSON(&user); err != nil {
		return &endpoint.ValidationResult{
			Valid:   false,
			Message: "Failed to parse user response",
		}, nil
	}

	// Get version info
	var version string
	sysResp, err := c.Client.Get(ctx, "/wiki/rest/api/settings/systemInfo", nil)
	if err == nil {
		var sysInfo SystemInfo
		if sysResp.JSON(&sysInfo) == nil {
			version = sysInfo.DatabaseVersion
		}
	}

	return &endpoint.ValidationResult{
		Valid:           true,
		Message:         fmt.Sprintf("Connected as %s", user.DisplayName),
		DetectedVersion: version,
	}, nil
}

// --- SourceEndpoint Interface ---

// ListDatasets returns available Confluence datasets.
func (c *Confluence) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	datasets := make([]*endpoint.Dataset, 0, len(DatasetDefinitions))
	for _, def := range DatasetDefinitions {
		datasets = append(datasets, def.ToDataset())
	}
	return datasets, nil
}

// GetSchema returns the schema for a dataset.
func (c *Confluence) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	fields := GetSchemaFields(datasetID)
	if fields == nil {
		return nil, fmt.Errorf("unknown dataset: %s", datasetID)
	}
	return &endpoint.Schema{Fields: fields}, nil
}

// Read returns an iterator for reading records from a dataset.
func (c *Confluence) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	switch req.DatasetID {
	case "confluence.space":
		return newSpaceIterator(c, ctx, req.Limit), nil
	case "confluence.page":
		return newPageIterator(c, ctx, req.Limit), nil
	case "confluence.attachment":
		return newAttachmentIterator(c, ctx, req.Limit), nil
	case "confluence.acl":
		return newACLIterator(c, ctx, req.Limit), nil
	default:
		return nil, fmt.Errorf("unknown dataset: %s", req.DatasetID)
	}
}

// --- SliceCapable Interface ---

// PlanSlices creates an ingestion plan for a dataset.
func (c *Confluence) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	// For now, return a single "full" slice
	return &endpoint.IngestionPlan{
		DatasetID: req.DatasetID,
		Strategy:  "full",
		Slices: []*endpoint.IngestionSlice{
			{
				SliceID:  "full",
				Sequence: 0,
			},
		},
	}, nil
}

// ReadSlice reads records within a bounded slice.
func (c *Confluence) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	// Delegate to Read for now
	return c.Read(ctx, &endpoint.ReadRequest{
		DatasetID: req.DatasetID,
		Slice:     req.Slice,
	})
}

// CountBetween returns count of records between bounds (not implemented for Confluence).
func (c *Confluence) CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error) {
	return 0, fmt.Errorf("CountBetween not supported for Confluence")
}

// GetCheckpoint returns the current checkpoint for a dataset.
func (c *Confluence) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	// No persistent checkpoint storage yet
	return nil, nil
}

// Close closes the connector.
func (c *Confluence) Close() error {
	return nil
}
