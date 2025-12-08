// Package bridge maps templateId to UCL connectors.
package bridge

import (
	"fmt"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	// Import connector package to register all connectors
	_ "github.com/nucleus/ucl-core/pkg/connector"
)

// TemplateMapping maps Python templateId to UCL endpoint ID
var TemplateMapping = map[string]string{
	// JDBC connectors
	"jdbc.generic":    "jdbc.generic",
	"jdbc.postgres":   "jdbc.postgres",
	"jdbc.postgresql": "jdbc.postgres",
	"jdbc.mysql":      "jdbc.mysql",
	"jdbc.mssql":      "jdbc.mssql",
	"jdbc.oracle":     "jdbc.oracle",

	// HTTP connectors
	"http.rest":       "http.rest",
	"http.jira":       "http.jira",
	"http.confluence": "http.confluence",

	// Cloud connectors
	"cloud.onedrive":  "cloud.onedrive",
	"http.onedrive":   "cloud.onedrive",

	// Storage connectors
	"hdfs.webhdfs":    "hdfs.webhdfs",
	"hdfs.parquet":    "hdfs.webhdfs",
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
			return v
		}
	}

	// Try nested in parameters
	if params, ok := policy["parameters"].(map[string]any); ok {
		for _, key := range []string{"templateId", "template_id", "template"} {
			if v, ok := params[key].(string); ok && v != "" {
				return v
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
