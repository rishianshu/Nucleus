package http

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// BASE HTTP ENDPOINT
// Provides common HTTP functionality for semantic connectors.
// =============================================================================

// Base provides common HTTP endpoint functionality.
// Embed this in connectors like Jira, Confluence, etc.
type Base struct {
	// Client is the HTTP client for making requests.
	Client *Client

	// EndpointID is the unique identifier for this endpoint.
	EndpointID string

	// EndpointName is the display name.
	EndpointName string

	// Vendor is the vendor name (e.g., "Atlassian", "Microsoft").
	Vendor string

	// Version is the detected API version.
	Version string
}

// NewBase creates a new HTTP base with the given configuration.
func NewBase(id, name, vendor string, config *ClientConfig) *Base {
	return &Base{
		Client:       NewClient(config),
		EndpointID:   id,
		EndpointName: name,
		Vendor:       vendor,
	}
}

// ID returns the endpoint identifier.
func (b *Base) ID() string {
	return b.EndpointID
}

// Close closes the HTTP client.
func (b *Base) Close() error {
	// HTTP client doesn't need explicit cleanup
	return nil
}

// GetCapabilities returns default HTTP source capabilities.
// Override in concrete implementations for specific capabilities.
func (b *Base) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: false,
		SupportsCountProbe:  false,
		SupportsPreview:     true,
		SupportsMetadata:    true,
		SupportsWrite:       false,
		DefaultFetchSize:    100,
	}
}

// GetDescriptor returns the endpoint descriptor.
// Override in concrete implementations.
func (b *Base) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:     b.EndpointID,
		Family: "http.rest",
		Title:  b.EndpointName,
		Vendor: b.Vendor,
	}
}

// ValidateConfig tests the connection by making a probe request.
func (b *Base) ValidateConfig(ctx context.Context, probePath string) (*endpoint.ValidationResult, error) {
	resp, err := b.Client.Get(ctx, probePath, nil)
	if err != nil {
		if httpErr, ok := err.(*HTTPError); ok {
			return &endpoint.ValidationResult{
				Valid:   false,
				Message: fmt.Sprintf("Connection failed: HTTP %d", httpErr.StatusCode),
			}, nil
		}
		return nil, err
	}

	return &endpoint.ValidationResult{
		Valid:           resp.IsSuccess(),
		Message:         "Connection successful",
		DetectedVersion: b.Version,
	}, nil
}

// =============================================================================
// HELPER METHODS
// =============================================================================

// FetchJSON fetches a JSON response and unmarshals it.
func (b *Base) FetchJSON(ctx context.Context, path string, target any) error {
	resp, err := b.Client.Get(ctx, path, nil)
	if err != nil {
		return err
	}
	return resp.JSON(target)
}

// FetchAll fetches all pages and collects results.
func (b *Base) FetchAll(ctx context.Context, path string, limit int, resultsKey string) ([]map[string]any, error) {
	var all []map[string]any

	paginator := NewOffsetPaginator(path, limit)
	paginator.ResultsKey = resultsKey

	req := paginator.FirstPage()
	for req != nil {
		resp, err := b.Client.Do(ctx, req)
		if err != nil {
			return nil, err
		}

		var data map[string]any
		if err := resp.JSON(&data); err != nil {
			return nil, err
		}

		if results, ok := data[resultsKey]; ok {
			if arr, ok := results.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						all = append(all, m)
					}
				}
			}
		}

		req, err = paginator.NextPage(ctx, resp)
		if err != nil {
			return nil, err
		}
	}

	return all, nil
}
