// Package bridge maps templateId to UCL connectors.
package bridge

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	// Import connector package to register all connectors
	_ "github.com/nucleus/ucl-core/pkg/connector"
)

// TemplateMapping maps legacy templateId to UCL endpoint ID
var TemplateMapping = map[string]string{
	// JDBC connectors
	// Note: Only registered connectors are mapped (see ucl-core/internal/connector/jdbc/register.go)
	"jdbc.postgres":   "jdbc.postgres",
	"jdbc.postgresql": "jdbc.postgres",
	"jdbc.oracle":     "jdbc.oracle",
	"jdbc.mssql":      "jdbc.sqlserver", // CODEX FIX: mssql maps to sqlserver
	"jdbc.sqlserver":  "jdbc.sqlserver",
	// TODO: Add jdbc.mysql and jdbc.generic when registered

	// HTTP connectors
	"jira.http":       "http.jira", // legacy ID used by TS/Python
	"http.rest":       "http.rest",
	"http.jira":       "http.jira",
	"http.confluence": "http.confluence",
	"confluence.http": "http.confluence",

	// Cloud connectors
	"cloud.onedrive":  "cloud.onedrive",
	"http.onedrive":   "cloud.onedrive",

	// Storage connectors
	"hdfs.webhdfs":    "hdfs.webhdfs",
	"hdfs.parquet":    "hdfs.webhdfs",
}

// CanonicalTemplateID returns the UCL-expected template id for a legacy id.
func CanonicalTemplateID(templateID string) string {
	if mapped, ok := TemplateMapping[templateID]; ok {
		return mapped
	}
	return templateID
}

// GetEndpoint creates a UCL endpoint from templateId and parameters.
func GetEndpoint(templateID string, params map[string]any) (endpoint.Endpoint, error) {
	endpointID, ok := TemplateMapping[templateID]
	if !ok {
		return nil, fmt.Errorf("unknown template ID: %s", templateID)
	}

	// Use the pkg/endpoint Create helper
	ep, err := endpoint.Create(endpointID, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint %s (from %s): %w", endpointID, templateID, err)
	}

	return ep, nil
}

// GetSourceEndpoint creates a UCL SourceEndpoint from templateId.
func GetSourceEndpoint(templateID string, params map[string]any) (endpoint.SourceEndpoint, error) {
	ep, err := GetEndpoint(templateID, params)
	if err != nil {
		return nil, err
	}

	source, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint %s does not support source operations", templateID)
	}

	return source, nil
}

// GetSliceCapableEndpoint returns endpoint that supports slice operations.
func GetSliceCapableEndpoint(templateID string, params map[string]any) (endpoint.SliceCapable, error) {
	ep, err := GetEndpoint(templateID, params)
	if err != nil {
		return nil, err
	}

	sliceCapable, ok := ep.(endpoint.SliceCapable)
	if !ok {
		return nil, fmt.Errorf("endpoint %s does not support slice operations", templateID)
	}

	return sliceCapable, nil
}

// ResolveTemplateID extracts templateId from policy object.
func ResolveTemplateID(policy map[string]any) string {
	// Try direct keys
	for _, key := range []string{"templateId", "template_id", "template"} {
		if v, ok := policy[key].(string); ok && v != "" {
			return CanonicalTemplateID(v)
		}
	}

	// Try nested in parameters
	if params, ok := policy["parameters"].(map[string]any); ok {
		for _, key := range []string{"templateId", "template_id", "template"} {
			if v, ok := params[key].(string); ok && v != "" {
				return CanonicalTemplateID(v)
			}
		}
	}

	return ""
}

// ResolveParameters extracts connection parameters from policy.
func ResolveParameters(policy map[string]any) map[string]any {
	if params, ok := policy["parameters"].(map[string]any); ok {
		return params
	}
	return policy
}

// NormalizeParameters adapts legacy parameter keys to the connector expectations.
// It returns a shallow-copied map (input not mutated).
func NormalizeParameters(templateID string, params map[string]any) map[string]any {
	out := make(map[string]any, len(params))
	for k, v := range params {
		out[k] = v
	}

	switch CanonicalTemplateID(templateID) {
	case "http.jira":
		// Align common legacy keys to Jira connector expectations
		copyIfPresent(out, params, "base_url", "baseUrl")
		copyIfPresent(out, params, "username", "email")
		copyIfPresent(out, params, "email", "email")
		copyIfPresent(out, params, "api_token", "apiToken")
		// project_keys can be comma-separated string; convert to []string
		if projects, ok := params["project_keys"].(string); ok && projects != "" {
			out["projects"] = splitCSV(projects)
		} else if projSlice, ok := params["projects"].([]string); ok {
			out["projects"] = projSlice
		}
		// jql filter
		if jql, ok := params["jqlFilter"].(string); ok && jql != "" {
			out["jql"] = jql
		} else if jql, ok := params["jql_filter"].(string); ok && jql != "" {
			out["jql"] = jql
		}
	case "http.confluence":
		copyIfPresent(out, params, "base_url", "baseUrl")
		copyIfPresent(out, params, "username", "email")
		copyIfPresent(out, params, "email", "email")
		copyIfPresent(out, params, "api_token", "apiToken")
		if spaces, ok := params["space_keys"].(string); ok && spaces != "" {
			out["spaces"] = splitCSV(spaces)
		} else if spaceSlice, ok := params["spaces"].([]string); ok {
			out["spaces"] = spaceSlice
		}
	case "cloud.onedrive":
		// Align common OneDrive keys
		copyIfPresent(out, params, "base_url", "baseUrl")
		copyIfPresent(out, params, "graph_base_url", "baseUrl")
		copyIfPresent(out, params, "client_id", "clientId")
		copyIfPresent(out, params, "client_secret", "clientSecret")
		copyIfPresent(out, params, "tenant_id", "tenantId")
		copyIfPresent(out, params, "drive_id", "driveId")
		copyIfPresent(out, params, "root_path", "rootPath")
		// refreshToken is required for real auth; pass through if present
		if rt, ok := params["refresh_token"].(string); ok && rt != "" {
			out["refreshToken"] = rt
		}
	case "jdbc.postgres", "jdbc.postgresql", "jdbc.oracle", "jdbc.sqlserver":
		// Normalize SSL mode and username casing
		copyIfPresent(out, params, "username", "user")
		// If ssl_mode/sslMode provided but empty, default to disable to avoid libpq SSL negotiation failures
		if mode, ok := params["ssl_mode"].(string); ok && strings.TrimSpace(mode) == "" {
			out["sslMode"] = "disable"
		} else if mode, ok := params["sslMode"].(string); ok && strings.TrimSpace(mode) == "" {
			out["sslMode"] = "disable"
		}
		// If neither provided, default explicitly
		if _, ok := out["sslMode"]; !ok {
			out["sslMode"] = "disable"
		}
	}

	return out
}

func copyIfPresent(dst, src map[string]any, from, to string) {
	if v, ok := src[from]; ok {
		dst[to] = v
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
