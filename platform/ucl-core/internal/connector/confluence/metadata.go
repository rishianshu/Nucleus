package confluence

import (
	"context"

	"github.com/nucleus/ucl-core/internal/core"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure Confluence implements MetadataCapable
var _ endpoint.MetadataCapable = (*Confluence)(nil)

// ProbeEnvironment probes the Confluence environment.
func (c *Confluence) ProbeEnvironment(ctx context.Context, config map[string]any) (*endpoint.Environment, error) {
	props := make(map[string]any)
	props["baseUrl"] = c.config.BaseURL

	// Get system info
	resp, err := c.Client.Get(ctx, "/wiki/rest/api/settings/systemInfo", nil)
	if err == nil {
		var sysInfo SystemInfo
		if resp.JSON(&sysInfo) == nil {
			props["cloudId"] = sysInfo.CloudID
			props["deploymentType"] = "Cloud"
		}
	}

	// Get current user
	userResp, err := c.Client.Get(ctx, "/wiki/rest/api/user/current", nil)
	if err == nil {
		var user CurrentUser
		if userResp.JSON(&user) == nil {
			props["currentUser"] = user.DisplayName
			props["accountType"] = user.AccountType
		}
	}

	var version string
	if v, ok := props["cloudId"].(string); ok && v != "" {
		version = "Cloud"
	}

	return &endpoint.Environment{
		Version:    version,
		Properties: props,
	}, nil
}

// CollectMetadata collects a catalog snapshot.
func (c *Confluence) CollectMetadata(ctx context.Context, env *endpoint.Environment) (*core.CatalogSnapshot, error) {
	snapshot := &core.CatalogSnapshot{
		Source: "confluence",
		Name:   "Confluence Catalog",
		DataSource: &core.DataSourceMetadata{
			Type:        "confluence",
			Name:        "Confluence Cloud",
			Description: "Atlassian Confluence documentation platform",
		},
	}

	return snapshot, nil
}
