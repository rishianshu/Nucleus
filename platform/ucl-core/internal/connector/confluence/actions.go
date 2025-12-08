package confluence

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure Confluence implements ActionEndpoint
var _ endpoint.ActionEndpoint = (*Confluence)(nil)

// =============================================================================
// ACTION DEFINITIONS
// =============================================================================

var confluenceActions = []*endpoint.ActionDescriptor{
	{
		ID:          "confluence.create_page",
		Name:        "Create Page",
		Description: "Create a new page in a Confluence space",
		Category:    "create",
	},
	{
		ID:          "confluence.update_page",
		Name:        "Update Page",
		Description: "Update an existing page content",
		Category:    "update",
	},
}

var confluenceActionSchemas = map[string]*endpoint.ActionSchema{
	"confluence.create_page": {
		ActionID: "confluence.create_page",
		InputFields: []*endpoint.ActionField{
			{Name: "spaceKey", Label: "Space Key", DataType: "string", Required: true, Description: "Space key (e.g., ENG)"},
			{Name: "title", Label: "Title", DataType: "string", Required: true, Description: "Page title"},
			{Name: "body", Label: "Body", DataType: "string", Required: false, Description: "Page content (plain text or storage format)"},
			{Name: "parentId", Label: "Parent Page ID", DataType: "string", Required: false, Description: "Parent page ID (optional)"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "pageId", Label: "Page ID", DataType: "string", Description: "Created page ID"},
			{Name: "title", Label: "Title", DataType: "string", Description: "Page title"},
			{Name: "url", Label: "URL", DataType: "string", Description: "Web URL of page"},
		},
	},
	"confluence.update_page": {
		ActionID: "confluence.update_page",
		InputFields: []*endpoint.ActionField{
			{Name: "pageId", Label: "Page ID", DataType: "string", Required: true, Description: "Page ID to update"},
			{Name: "title", Label: "Title", DataType: "string", Required: false, Description: "New title (optional)"},
			{Name: "body", Label: "Body", DataType: "string", Required: false, Description: "New content"},
			{Name: "version", Label: "Version", DataType: "number", Required: true, Description: "Current version number (for conflict detection)"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "pageId", Label: "Page ID", DataType: "string", Description: "Updated page ID"},
			{Name: "version", Label: "Version", DataType: "number", Description: "New version number"},
		},
	},
}

func init() {
	endpoint.RegisterActions("http.confluence", confluenceActions)
}

// =============================================================================
// ACTION ENDPOINT IMPLEMENTATION
// =============================================================================

// ListActions returns available Confluence actions.
func (c *Confluence) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return confluenceActions, nil
}

// GetActionSchema returns the schema for a specific action.
func (c *Confluence) GetActionSchema(ctx context.Context, actionID string) (*endpoint.ActionSchema, error) {
	schema, ok := confluenceActionSchemas[actionID]
	if !ok {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
	return schema, nil
}

// ExecuteAction executes a Confluence action.
func (c *Confluence) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	if req.DryRun {
		return &endpoint.ActionResult{
			Success: true,
			Message: "Dry run - action validated but not executed",
		}, nil
	}

	switch req.ActionID {
	case "confluence.create_page":
		return c.createPage(ctx, req.Parameters)
	case "confluence.update_page":
		return c.updatePage(ctx, req.Parameters)
	default:
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Unknown action: %s", req.ActionID),
			Errors:  []endpoint.ActionError{{Code: "UNKNOWN_ACTION", Message: req.ActionID}},
		}, nil
	}
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

func (c *Confluence) createPage(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	spaceKey, _ := params["spaceKey"].(string)
	title, _ := params["title"].(string)
	body, _ := params["body"].(string)

	payload := map[string]any{
		"type":  "page",
		"title": title,
		"space": map[string]any{
			"key": spaceKey,
		},
		"body": map[string]any{
			"storage": map[string]any{
				"value":          body,
				"representation": "storage",
			},
		},
	}

	if parentID, ok := params["parentId"].(string); ok && parentID != "" {
		payload["ancestors"] = []map[string]any{
			{"id": parentID},
		}
	}

	jsonBody, _ := json.Marshal(payload)
	resp, err := c.Client.Post(ctx, "/wiki/rest/api/content", jsonBody)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to create page: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Links *Links `json:"_links"`
	}
	if err := resp.JSON(&result); err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to parse response",
			Errors:  []endpoint.ActionError{{Code: "PARSE_ERROR", Message: err.Error()}},
		}, nil
	}

	webURL := ""
	if result.Links != nil {
		webURL = result.Links.Base + result.Links.WebUI
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Created page '%s'", result.Title),
		Data: map[string]any{
			"pageId": result.ID,
			"title":  result.Title,
			"url":    webURL,
		},
	}, nil
}

func (c *Confluence) updatePage(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	pageID, _ := params["pageId"].(string)
	title, _ := params["title"].(string)
	body, _ := params["body"].(string)
	version, _ := params["version"].(float64)

	payload := map[string]any{
		"type": "page",
		"version": map[string]any{
			"number": int(version) + 1,
		},
	}

	if title != "" {
		payload["title"] = title
	}

	if body != "" {
		payload["body"] = map[string]any{
			"storage": map[string]any{
				"value":          body,
				"representation": "storage",
			},
		}
	}

	jsonBody, _ := json.Marshal(payload)
	path := fmt.Sprintf("/wiki/rest/api/content/%s", pageID)
	resp, err := c.Client.Put(ctx, path, jsonBody)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to update page: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID      string `json:"id"`
		Version struct {
			Number int `json:"number"`
		} `json:"version"`
	}
	if err := resp.JSON(&result); err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to parse response",
			Errors:  []endpoint.ActionError{{Code: "PARSE_ERROR", Message: err.Error()}},
		}, nil
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Updated page %s to version %d", result.ID, result.Version.Number),
		Data: map[string]any{
			"pageId":  result.ID,
			"version": result.Version.Number,
		},
	}, nil
}
