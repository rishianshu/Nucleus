// Package ucl provides a gRPC client for the UCL service.
package ucl

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	uclpb "github.com/nucleus/ucl-core/gen/go/proto"
)

// Client wraps the UCL gRPC client.
type Client struct {
	conn   *grpc.ClientConn
	client uclpb.UCLServiceClient
}

// NewClient creates a new UCL gRPC client.
func NewClient(address string) (*Client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to UCL service at %s: %w", address, err)
	}

	return &Client{
		conn:   conn,
		client: uclpb.NewUCLServiceClient(conn),
	}, nil
}

// Close closes the gRPC connection.
func (c *Client) Close() error {
	return c.conn.Close()
}

// =============================================================================
// TEMPLATE OPERATIONS
// =============================================================================

// EndpointTemplate represents a template descriptor.
type EndpointTemplate struct {
	ID          string             `json:"id"`
	Family      string             `json:"family"`
	DisplayName string             `json:"displayName"`
	Vendor      string             `json:"vendor"`
	Description string             `json:"description"`
	Categories  []string           `json:"categories"`
	Fields      []FieldDescriptor  `json:"fields"`
}

// FieldDescriptor describes a configuration field.
type FieldDescriptor struct {
	Name         string   `json:"name"`
	Type         string   `json:"type"`
	Label        string   `json:"label"`
	Description  string   `json:"description"`
	Required     bool     `json:"required"`
	DefaultValue string   `json:"defaultValue,omitempty"`
	Options      []string `json:"options,omitempty"`
}

// ListEndpointTemplates returns available templates.
func (c *Client) ListEndpointTemplates(ctx context.Context, family string) ([]EndpointTemplate, error) {
	resp, err := c.client.ListEndpointTemplates(ctx, &uclpb.ListTemplatesRequest{
		Family: family,
	})
	if err != nil {
		return nil, err
	}

	templates := make([]EndpointTemplate, len(resp.Templates))
	for i, t := range resp.Templates {
		fields := make([]FieldDescriptor, len(t.Fields))
		for j, f := range t.Fields {
			fields[j] = FieldDescriptor{
				Name:         f.Name,
				Type:         f.Type,
				Label:        f.Label,
				Description:  f.Description,
				Required:     f.Required,
				DefaultValue: f.DefaultValue,
				Options:      f.Options,
			}
		}
		templates[i] = EndpointTemplate{
			ID:          t.Id,
			Family:      t.Family,
			DisplayName: t.DisplayName,
			Vendor:      t.Vendor,
			Description: t.Description,
			Categories:  t.Categories,
			Fields:      fields,
		}
	}
	return templates, nil
}

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

// BuildConfigResult is the result of building a config.
type BuildConfigResult struct {
	Success       bool              `json:"success"`
	Config        map[string]string `json:"config,omitempty"`
	ConnectionURL string            `json:"connectionUrl,omitempty"`
	Error         string            `json:"error,omitempty"`
}

// BuildEndpointConfig builds an endpoint configuration from a template.
func (c *Client) BuildEndpointConfig(ctx context.Context, templateID string, parameters map[string]string, labels []string) (*BuildConfigResult, error) {
	resp, err := c.client.BuildEndpointConfig(ctx, &uclpb.BuildConfigRequest{
		TemplateId: templateID,
		Parameters: parameters,
		Labels:     labels,
	})
	if err != nil {
		return nil, err
	}

	return &BuildConfigResult{
		Success:       resp.Success,
		Config:        resp.Config,
		ConnectionURL: resp.ConnectionUrl,
		Error:         resp.Error,
	}, nil
}

// =============================================================================
// CONNECTION TEST
// =============================================================================

// TestConnectionResult is the result of a connection test.
type TestConnectionResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message,omitempty"`
	Error     string `json:"error,omitempty"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
}

// TestEndpointConnection tests connectivity to an endpoint.
func (c *Client) TestEndpointConnection(ctx context.Context, templateID string, parameters map[string]string) (*TestConnectionResult, error) {
	resp, err := c.client.TestEndpointConnection(ctx, &uclpb.TestConnectionRequest{
		TemplateId: templateID,
		Parameters: parameters,
	})
	if err != nil {
		return nil, err
	}

	return &TestConnectionResult{
		Success:   resp.Success,
		Message:   resp.Message,
		Error:     resp.Error,
		LatencyMs: resp.LatencyMs,
	}, nil
}

// =============================================================================
// DATASET OPERATIONS
// =============================================================================

// Dataset represents a dataset from an endpoint.
type Dataset struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Description         string            `json:"description,omitempty"`
	Kind                string            `json:"kind"` // table, view, stream, topic
	SupportsIncremental bool              `json:"supportsIncremental"`
	CDMModelID          string            `json:"cdmModelId,omitempty"`
	IngestionStrategy   string            `json:"ingestionStrategy,omitempty"`
	IncrementalColumn   string            `json:"incrementalColumn,omitempty"`
	IncrementalLiteral  string            `json:"incrementalLiteral,omitempty"`
	PrimaryKeys         []string          `json:"primaryKeys,omitempty"`
	Metadata            map[string]string `json:"metadata,omitempty"`
}

// ListDatasets returns available datasets for an endpoint.
func (c *Client) ListDatasets(ctx context.Context, endpointID string, config map[string]string) ([]Dataset, error) {
	resp, err := c.client.ListDatasets(ctx, &uclpb.ListDatasetsRequest{
		EndpointId: endpointID,
		Config:     config,
	})
	if err != nil {
		return nil, err
	}

	datasets := make([]Dataset, len(resp.Datasets))
	for i, d := range resp.Datasets {
		datasets[i] = Dataset{
			ID:                  d.Id,
			Name:                d.Name,
			Description:         d.Description,
			Kind:                d.Kind,
			SupportsIncremental: d.SupportsIncremental,
			CDMModelID:          d.CdmModelId,
			IngestionStrategy:   d.IngestionStrategy,
			IncrementalColumn:   d.IncrementalColumn,
			IncrementalLiteral:  d.IncrementalLiteral,
			PrimaryKeys:         d.PrimaryKeys,
			Metadata:            d.Metadata,
		}
	}
	return datasets, nil
}

// =============================================================================
// SCHEMA OPERATIONS
// =============================================================================

// SchemaField describes a field in a dataset schema.
type SchemaField struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Nullable     bool   `json:"nullable"`
	IsPrimaryKey bool   `json:"isPrimaryKey"`
	Description  string `json:"description,omitempty"`
	Precision    int32  `json:"precision,omitempty"`
	Scale        int32  `json:"scale,omitempty"`
	Length       int32  `json:"length,omitempty"`
}

// GetSchema returns the schema for a dataset.
func (c *Client) GetSchema(ctx context.Context, endpointID, datasetID string, config map[string]string) ([]SchemaField, error) {
	resp, err := c.client.GetSchema(ctx, &uclpb.GetSchemaRequest{
		EndpointId: endpointID,
		DatasetId:  datasetID,
		Config:     config,
	})
	if err != nil {
		return nil, err
	}

	fields := make([]SchemaField, len(resp.Fields))
	for i, f := range resp.Fields {
		fields[i] = SchemaField{
			Name:         f.Name,
			Type:         f.Type,
			Nullable:     f.Nullable,
			IsPrimaryKey: f.IsPrimaryKey,
			Description:  f.Description,
			Precision:    f.Precision,
			Scale:        f.Scale,
			Length:       f.Length,
		}
	}
	return fields, nil
}
