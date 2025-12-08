package jira

import (
	"context"
	"fmt"
	"time"

	"github.com/nucleus/ucl-core/internal/core"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure MetadataCapable compliance
var _ endpoint.MetadataCapable = (*Jira)(nil)

// =============================================================================
// METADATA CAPABLE
// Implements endpoint.MetadataCapable for catalog collection.
// =============================================================================

// ProbeEnvironment gathers Jira server metadata.
func (j *Jira) ProbeEnvironment(ctx context.Context, config map[string]any) (*endpoint.Environment, error) {
	resp, err := j.Client.Get(ctx, "/rest/api/3/serverInfo", nil)
	if err != nil {
		return nil, fmt.Errorf("probe environment: %w", err)
	}

	var serverInfo struct {
		Version        string `json:"version"`
		BaseUrl        string `json:"baseUrl"`
		BuildNumber    int    `json:"buildNumber"`
		DeploymentType string `json:"deploymentType"`
		ServerTitle    string `json:"serverTitle"`
	}
	if err := resp.JSON(&serverInfo); err != nil {
		return nil, fmt.Errorf("parse server info: %w", err)
	}

	return &endpoint.Environment{
		Version: serverInfo.Version,
		Properties: map[string]any{
			"baseUrl":        serverInfo.BaseUrl,
			"buildNumber":    serverInfo.BuildNumber,
			"deploymentType": serverInfo.DeploymentType,
			"serverTitle":    serverInfo.ServerTitle,
		},
	}, nil
}

// CollectMetadata produces a catalog snapshot for Jira datasets.
func (j *Jira) CollectMetadata(ctx context.Context, env *endpoint.Environment) (*endpoint.CatalogSnapshot, error) {
	// Build data source metadata
	dataSource := &core.DataSourceMetadata{
		ID:          j.ID(),
		Name:        "Jira",
		Type:        "jira",
		System:      j.config.BaseURL,
		Version:     env.Version,
		Description: "Jira Cloud instance",
		Properties: map[string]any{
			"vendor":         "Atlassian",
			"deploymentType": env.Properties["deploymentType"],
		},
	}

	// Collect dataset metadata
	datasets := make([]*core.DatasetMetadata, 0, len(DatasetDefinitions))
	for id, def := range DatasetDefinitions {
		schema, _ := j.GetSchema(ctx, id)
		
		// Count records if supported
		var rowCount int64
		if def.Handler == "issues" {
			count, err := j.CountBetween(ctx, id, "", "")
			if err == nil {
				rowCount = count
			}
		}

		datasets = append(datasets, &core.DatasetMetadata{
			ID:           id,
			Name:         def.Name,
			PhysicalName: id,
			Type:         "semantic",
			SourceID:     j.ID(),
			Location:     def.Entity,
			Description:  def.Description,
			Tags: map[string]any{
				"vendor":    "atlassian",
				"domain":    "work",
				"cdmModel":  def.CdmModelID,
			},
			Properties: map[string]any{
				"handler":             def.Handler,
				"supportsIncremental": def.SupportsIncremental,
				"incrementalCursor":   def.IncrementalCursor,
				"fieldCount":          len(def.StaticFields),
				"rowCount":            rowCount,
				"schema":              schema,
			},
		})
	}

	return &endpoint.CatalogSnapshot{
		Source:      "jira",
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		DataSource:  dataSource,
		Dataset:     datasets[0], // Primary dataset
		Fields:      j.buildSchemaFields(ctx),
		Extras: map[string]any{
			"environment": env,
			"datasets":    datasets,
		},
	}, nil
}

// buildSchemaFields collects all fields across datasets.
func (j *Jira) buildSchemaFields(ctx context.Context) []*core.SchemaField {
	var fields []*core.SchemaField
	
	// Collect fields from all datasets
	for id, def := range DatasetDefinitions {
		for i, f := range def.StaticFields {
			fields = append(fields, &core.SchemaField{
				Name:     fmt.Sprintf("%s.%s", id, f.Name),
				DataType: f.DataType,
				Nullable: f.Nullable,
				Comment:  f.Comment,
				Position: i + 1,
			})
		}
	}
	
	return fields
}
