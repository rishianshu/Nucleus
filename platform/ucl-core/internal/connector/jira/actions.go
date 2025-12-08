package jira

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure Jira implements ActionEndpoint
var _ endpoint.ActionEndpoint = (*Jira)(nil)

// =============================================================================
// ACTION DEFINITIONS
// =============================================================================

var jiraActions = []*endpoint.ActionDescriptor{
	{
		ID:          "jira.create_issue",
		Name:        "Create Issue",
		Description: "Create a new issue in a Jira project",
		Category:    "create",
	},
	{
		ID:          "jira.update_issue",
		Name:        "Update Issue",
		Description: "Update fields on an existing issue",
		Category:    "update",
	},
	{
		ID:          "jira.transition_issue",
		Name:        "Transition Issue",
		Description: "Change the status of an issue via workflow transition",
		Category:    "update",
	},
	{
		ID:          "jira.add_comment",
		Name:        "Add Comment",
		Description: "Add a comment to an existing issue",
		Category:    "create",
	},
}

// Action schemas
var actionSchemas = map[string]*endpoint.ActionSchema{
	"jira.create_issue": {
		ActionID: "jira.create_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "projectKey", Label: "Project Key", DataType: "string", Required: true, Description: "Project key (e.g., ENG)"},
			{Name: "summary", Label: "Summary", DataType: "string", Required: true, Description: "Issue title"},
			{Name: "description", Label: "Description", DataType: "string", Required: false, Description: "Issue description"},
			{Name: "issueType", Label: "Issue Type", DataType: "string", Required: true, Default: "Task", Description: "Issue type name"},
			{Name: "assignee", Label: "Assignee", DataType: "string", Required: false, Description: "Assignee account ID"},
			{Name: "priority", Label: "Priority", DataType: "string", Required: false, Description: "Priority name"},
			{Name: "labels", Label: "Labels", DataType: "array", Required: false, Description: "Issue labels"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "issueKey", Label: "Issue Key", DataType: "string", Description: "Created issue key"},
			{Name: "issueId", Label: "Issue ID", DataType: "string", Description: "Created issue ID"},
			{Name: "self", Label: "Self URL", DataType: "string", Description: "API URL of created issue"},
		},
	},
	"jira.transition_issue": {
		ActionID: "jira.transition_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "issueKey", Label: "Issue Key", DataType: "string", Required: true, Description: "Issue key (e.g., ENG-123)"},
			{Name: "transitionId", Label: "Transition ID", DataType: "string", Required: true, Description: "Workflow transition ID"},
			{Name: "comment", Label: "Comment", DataType: "string", Required: false, Description: "Comment to add with transition"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "success", Label: "Success", DataType: "boolean", Description: "Whether transition succeeded"},
		},
	},
	"jira.add_comment": {
		ActionID: "jira.add_comment",
		InputFields: []*endpoint.ActionField{
			{Name: "issueKey", Label: "Issue Key", DataType: "string", Required: true, Description: "Issue key (e.g., ENG-123)"},
			{Name: "body", Label: "Comment Body", DataType: "string", Required: true, Description: "Comment content"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "commentId", Label: "Comment ID", DataType: "string", Description: "Created comment ID"},
			{Name: "self", Label: "Self URL", DataType: "string", Description: "API URL of comment"},
		},
	},
	"jira.update_issue": {
		ActionID: "jira.update_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "issueKey", Label: "Issue Key", DataType: "string", Required: true, Description: "Issue key (e.g., ENG-123)"},
			{Name: "summary", Label: "Summary", DataType: "string", Required: false, Description: "New summary/title"},
			{Name: "description", Label: "Description", DataType: "string", Required: false, Description: "New description"},
			{Name: "assignee", Label: "Assignee", DataType: "string", Required: false, Description: "Assignee account ID"},
			{Name: "priority", Label: "Priority", DataType: "string", Required: false, Description: "Priority name"},
			{Name: "labels", Label: "Labels", DataType: "array", Required: false, Description: "Issue labels"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "success", Label: "Success", DataType: "boolean", Description: "Whether update succeeded"},
		},
	},
}

func init() {
	endpoint.RegisterActions("http.jira", jiraActions)
}

// =============================================================================
// ACTION ENDPOINT IMPLEMENTATION
// =============================================================================

// ListActions returns available Jira actions.
func (j *Jira) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return jiraActions, nil
}

// GetActionSchema returns the schema for a specific action.
func (j *Jira) GetActionSchema(ctx context.Context, actionID string) (*endpoint.ActionSchema, error) {
	schema, ok := actionSchemas[actionID]
	if !ok {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
	return schema, nil
}

// ExecuteAction executes a Jira action.
func (j *Jira) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	// Validate ActionID first
	switch req.ActionID {
	case "jira.create_issue", "jira.update_issue", "jira.transition_issue", "jira.add_comment":
		// Valid action
	default:
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Unknown action: %s", req.ActionID),
			Errors:  []endpoint.ActionError{{Code: "UNKNOWN_ACTION", Message: req.ActionID}},
		}, nil
	}

	if req.DryRun {
		return &endpoint.ActionResult{
			Success: true,
			Message: fmt.Sprintf("Dry run - action '%s' validated but not executed", req.ActionID),
		}, nil
	}

	switch req.ActionID {
	case "jira.create_issue":
		return j.createIssue(ctx, req.Parameters)
	case "jira.update_issue":
		return j.updateIssue(ctx, req.Parameters)
	case "jira.transition_issue":
		return j.transitionIssue(ctx, req.Parameters)
	case "jira.add_comment":
		return j.addComment(ctx, req.Parameters)
	default:
		// Already validated above
		return nil, nil
	}
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

func (j *Jira) createIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	projectKey, _ := params["projectKey"].(string)
	summary, _ := params["summary"].(string)
	description, _ := params["description"].(string)
	issueType, _ := params["issueType"].(string)
	if issueType == "" {
		issueType = "Task"
	}

	// Build issue payload
	payload := map[string]any{
		"fields": map[string]any{
			"project":   map[string]any{"key": projectKey},
			"summary":   summary,
			"issuetype": map[string]any{"name": issueType},
		},
	}

	if description != "" {
		fields := payload["fields"].(map[string]any)
		fields["description"] = map[string]any{
			"type":    "doc",
			"version": 1,
			"content": []map[string]any{
				{
					"type": "paragraph",
					"content": []map[string]any{
						{"type": "text", "text": description},
					},
				},
			},
		}
	}

	if assignee, ok := params["assignee"].(string); ok && assignee != "" {
		fields := payload["fields"].(map[string]any)
		fields["assignee"] = map[string]any{"accountId": assignee}
	}

	if priority, ok := params["priority"].(string); ok && priority != "" {
		fields := payload["fields"].(map[string]any)
		fields["priority"] = map[string]any{"name": priority}
	}

	// Handle labels - can be []string or []any from JSON
	if labelsRaw, ok := params["labels"]; ok {
		fields := payload["fields"].(map[string]any)
		switch v := labelsRaw.(type) {
		case []string:
			if len(v) > 0 {
				fields["labels"] = v
			}
		case []any:
			if len(v) > 0 {
				labels := make([]string, 0, len(v))
				for _, l := range v {
					if s, ok := l.(string); ok {
						labels = append(labels, s)
					}
				}
				if len(labels) > 0 {
					fields["labels"] = labels
				}
			}
		}
	}

	// Make API call - Post method handles JSON marshaling
	resp, err := j.Client.Post(ctx, "/rest/api/3/issue", payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to create issue: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID   string `json:"id"`
		Key  string `json:"key"`
		Self string `json:"self"`
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
		Message: fmt.Sprintf("Created issue %s", result.Key),
		Data: map[string]any{
			"issueKey": result.Key,
			"issueId":  result.ID,
			"self":     result.Self,
		},
	}, nil
}

func (j *Jira) transitionIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	issueKey, _ := params["issueKey"].(string)
	transitionID, _ := params["transitionId"].(string)

	payload := map[string]any{
		"transition": map[string]any{
			"id": transitionID,
		},
	}

	if comment, ok := params["comment"].(string); ok && comment != "" {
		payload["update"] = map[string]any{
			"comment": []map[string]any{
				{
					"add": map[string]any{
						"body": map[string]any{
							"type":    "doc",
							"version": 1,
							"content": []map[string]any{
								{
									"type": "paragraph",
									"content": []map[string]any{
										{"type": "text", "text": comment},
									},
								},
							},
						},
					},
				},
			},
		}
	}

	path := fmt.Sprintf("/rest/api/3/issue/%s/transitions", issueKey)
	_, err := j.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to transition issue: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Transitioned issue %s", issueKey),
		Data:    map[string]any{"success": true},
	}, nil
}

func (j *Jira) addComment(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	issueKey, _ := params["issueKey"].(string)
	commentBody, _ := params["body"].(string)

	payload := map[string]any{
		"body": map[string]any{
			"type":    "doc",
			"version": 1,
			"content": []map[string]any{
				{
					"type": "paragraph",
					"content": []map[string]any{
						{"type": "text", "text": commentBody},
					},
				},
			},
		},
	}

	path := fmt.Sprintf("/rest/api/3/issue/%s/comment", issueKey)
	resp, err := j.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to add comment: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID   string `json:"id"`
		Self string `json:"self"`
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
		Message: fmt.Sprintf("Added comment to %s", issueKey),
		Data: map[string]any{
			"commentId": result.ID,
			"self":      result.Self,
		},
	}, nil
}

func (j *Jira) updateIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	issueKey, _ := params["issueKey"].(string)
	if issueKey == "" {
		return &endpoint.ActionResult{
			Success: false,
			Message: "issueKey is required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "issueKey"}},
		}, nil
	}

	// Build update payload - only include non-empty fields
	fields := make(map[string]any)

	if summary, ok := params["summary"].(string); ok && summary != "" {
		fields["summary"] = summary
	}

	if description, ok := params["description"].(string); ok && description != "" {
		fields["description"] = map[string]any{
			"type":    "doc",
			"version": 1,
			"content": []map[string]any{
				{
					"type": "paragraph",
					"content": []map[string]any{
						{"type": "text", "text": description},
					},
				},
			},
		}
	}

	if assignee, ok := params["assignee"].(string); ok && assignee != "" {
		fields["assignee"] = map[string]any{"accountId": assignee}
	}

	if priority, ok := params["priority"].(string); ok && priority != "" {
		fields["priority"] = map[string]any{"name": priority}
	}

	// Handle labels
	if labelsRaw, ok := params["labels"]; ok {
		switch v := labelsRaw.(type) {
		case []string:
			if len(v) > 0 {
				fields["labels"] = v
			}
		case []any:
			if len(v) > 0 {
				labels := make([]string, 0, len(v))
				for _, l := range v {
					if s, ok := l.(string); ok {
						labels = append(labels, s)
					}
				}
				if len(labels) > 0 {
					fields["labels"] = labels
				}
			}
		}
	}

	if len(fields) == 0 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "At least one field must be specified to update",
			Errors:  []endpoint.ActionError{{Code: "NO_FIELDS", Message: "no fields to update"}},
		}, nil
	}

	payload := map[string]any{"fields": fields}

	// Make API call - PUT /rest/api/3/issue/{issueIdOrKey}
	path := fmt.Sprintf("/rest/api/3/issue/%s", issueKey)
	_, err := j.Client.Put(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to update issue: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Updated issue %s", issueKey),
		Data: map[string]any{
			"success": true,
		},
	}, nil
}
