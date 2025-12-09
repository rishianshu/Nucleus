// Package temporal provides UCL gRPC-based activities.
// These activities use the UCL gRPC service instead of the deprecated Python CLI.
package temporal

import (
	"context"
	"encoding/json"
	"fmt"

	"go.temporal.io/sdk/activity"

	"github.com/nucleus/metadata-api/internal/database"
	"github.com/nucleus/metadata-api/internal/ucl"
)

// UCLActivities provides activity implementations that use the UCL gRPC service.
type UCLActivities struct {
	db  *database.Client
	ucl *ucl.Client
}

// NewUCLActivities creates a new UCLActivities instance.
func NewUCLActivities(db *database.Client, uclClient *ucl.Client) *UCLActivities {
	return &UCLActivities{
		db:  db,
		ucl: uclClient,
	}
}

// =============================================================================
// LIST ENDPOINT TEMPLATES
// =============================================================================

// ListEndpointTemplatesInput is the input for ListEndpointTemplates.
type ListEndpointTemplatesInput struct {
	Family string `json:"family,omitempty"` // JDBC, HTTP, STREAM
}

// ListEndpointTemplates lists available endpoint templates via gRPC.
func (a *UCLActivities) ListEndpointTemplates(ctx context.Context, input ListEndpointTemplatesInput) ([]ucl.EndpointTemplate, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("listing endpoint templates", "family", input.Family)

	templates, err := a.ucl.ListEndpointTemplates(ctx, input.Family)
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}

	// Cache templates in database
	if err := a.cacheTemplates(ctx, templates); err != nil {
		logger.Warn("failed to cache templates", "error", err)
	}

	return templates, nil
}

func (a *UCLActivities) cacheTemplates(ctx context.Context, templates []ucl.EndpointTemplate) error {
	dbTemplates := make([]*database.EndpointTemplate, len(templates))
	for i, t := range templates {
		dbTemplates[i] = &database.EndpointTemplate{
			ID:          t.ID,
			Family:      t.Family,
			Title:       t.DisplayName,
			Vendor:      t.Vendor,
			Description: database.ToNullString(t.Description),
			Categories:  t.Categories,
		}
	}
	return a.db.SaveEndpointTemplates(ctx, dbTemplates)
}

// =============================================================================
// BUILD ENDPOINT CONFIG
// =============================================================================

// BuildEndpointConfigInput is the input for BuildEndpointConfig.
type BuildEndpointConfigInput struct {
	TemplateID string            `json:"templateId"`
	Parameters map[string]string `json:"parameters"`
	Labels     []string          `json:"labels,omitempty"`
}

// BuildEndpointConfig builds an endpoint config from a template via gRPC.
func (a *UCLActivities) BuildEndpointConfig(ctx context.Context, input BuildEndpointConfigInput) (*ucl.BuildConfigResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("building endpoint config", "templateId", input.TemplateID)

	result, err := a.ucl.BuildEndpointConfig(ctx, input.TemplateID, input.Parameters, input.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to build config: %w", err)
	}

	if !result.Success && result.Error != "" {
		return nil, fmt.Errorf("config build failed: %s", result.Error)
	}

	return result, nil
}

// =============================================================================
// TEST ENDPOINT CONNECTION
// =============================================================================

// TestEndpointConnectionInput is the input for TestEndpointConnection.
type TestEndpointConnectionInput struct {
	TemplateID string            `json:"templateId"`
	Parameters map[string]string `json:"parameters"`
}

// TestEndpointConnection tests connectivity to an endpoint via gRPC.
func (a *UCLActivities) TestEndpointConnection(ctx context.Context, input TestEndpointConnectionInput) (*ucl.TestConnectionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("testing endpoint connection", "templateId", input.TemplateID)

	result, err := a.ucl.TestEndpointConnection(ctx, input.TemplateID, input.Parameters)
	if err != nil {
		return nil, fmt.Errorf("failed to test connection: %w", err)
	}

	if !result.Success && result.Error != "" {
		logger.Warn("connection test failed", "error", result.Error)
	}

	return result, nil
}

// =============================================================================
// VALIDATE CONFIG
// =============================================================================

// ValidateConfigInput is the input for ValidateConfig.
type ValidateConfigInput struct {
	EndpointID string            `json:"endpointId"`
	Config     map[string]string `json:"config"`
}

// ValidateConfigResult is the result of config validation.
type ValidateConfigResult struct {
	Valid    bool     `json:"valid"`
	Errors   []string `json:"errors,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// ValidateConfig validates an endpoint configuration via gRPC.
func (a *UCLActivities) ValidateConfig(ctx context.Context, input ValidateConfigInput) (*ValidateConfigResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("validating config", "endpointId", input.EndpointID)

	// TODO: Call UCL gRPC ValidateConfig when implemented
	// For now, return valid
	return &ValidateConfigResult{
		Valid:    true,
		Errors:   []string{},
		Warnings: []string{},
	}, nil
}

// =============================================================================
// LIST DATASETS
// =============================================================================

// ListDatasetsInput is the input for ListDatasets.
type ListDatasetsInput struct {
	EndpointID string            `json:"endpointId"`
	Config     map[string]string `json:"config,omitempty"`
}

// ListDatasets lists available datasets for an endpoint via gRPC.
func (a *UCLActivities) ListDatasets(ctx context.Context, input ListDatasetsInput) ([]ucl.Dataset, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("listing datasets", "endpointId", input.EndpointID)

	// Get endpoint config if not provided
	config := input.Config
	if config == nil {
		endpoint, err := a.db.GetEndpoint(ctx, input.EndpointID)
		if err != nil {
			return nil, fmt.Errorf("failed to get endpoint: %w", err)
		}
		if endpoint == nil {
			return nil, fmt.Errorf("endpoint %s not found", input.EndpointID)
		}
		config = jsonToStringMap(endpoint.Config)
	}

	datasets, err := a.ucl.ListDatasets(ctx, input.EndpointID, config)
	if err != nil {
		return nil, fmt.Errorf("failed to list datasets: %w", err)
	}

	return datasets, nil
}

// =============================================================================
// GET SCHEMA
// =============================================================================

// GetSchemaInput is the input for GetSchema.
type GetSchemaInput struct {
	EndpointID string            `json:"endpointId"`
	DatasetID  string            `json:"datasetId"`
	Config     map[string]string `json:"config,omitempty"`
}

// GetSchema retrieves the schema for a dataset via gRPC.
func (a *UCLActivities) GetSchema(ctx context.Context, input GetSchemaInput) ([]ucl.SchemaField, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("getting schema", "endpointId", input.EndpointID, "datasetId", input.DatasetID)

	config := input.Config
	if config == nil {
		endpoint, err := a.db.GetEndpoint(ctx, input.EndpointID)
		if err != nil {
			return nil, fmt.Errorf("failed to get endpoint: %w", err)
		}
		if endpoint == nil {
			return nil, fmt.Errorf("endpoint %s not found", input.EndpointID)
		}
		config = jsonToStringMap(endpoint.Config)
	}

	fields, err := a.ucl.GetSchema(ctx, input.EndpointID, input.DatasetID, config)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	return fields, nil
}

// =============================================================================
// HELPERS
// =============================================================================

func jsonToStringMap(data []byte) map[string]string {
	result := make(map[string]string)
	if len(data) == 0 {
		return result
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return result
	}

	for k, v := range parsed {
		if s, ok := v.(string); ok {
			result[k] = s
		}
	}
	return result
}
