package github

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure GitHub implements ActionEndpoint
var _ endpoint.ActionEndpoint = (*GitHub)(nil)

// =============================================================================
// ACTION DEFINITIONS
// =============================================================================

var githubActions = []*endpoint.ActionDescriptor{
	{
		ID:          "github.create_issue",
		Name:        "Create Issue",
		Description: "Create a new issue in a GitHub repository",
		Category:    "create",
	},
	{
		ID:          "github.update_issue",
		Name:        "Update Issue",
		Description: "Update fields on an existing issue",
		Category:    "update",
	},
	{
		ID:          "github.close_issue",
		Name:        "Close Issue",
		Description: "Close an open issue",
		Category:    "update",
	},
	{
		ID:          "github.add_comment",
		Name:        "Add Comment",
		Description: "Add a comment to an issue or pull request",
		Category:    "create",
	},
	{
		ID:          "github.create_pr",
		Name:        "Create Pull Request",
		Description: "Create a new pull request",
		Category:    "create",
	},
	{
		ID:          "github.merge_pr",
		Name:        "Merge Pull Request",
		Description: "Merge an open pull request",
		Category:    "update",
	},
	{
		ID:          "github.add_labels",
		Name:        "Add Labels",
		Description: "Add labels to an issue or pull request",
		Category:    "update",
	},
	{
		ID:          "github.assign_users",
		Name:        "Assign Users",
		Description: "Assign users to an issue or pull request",
		Category:    "update",
	},
}

// Action schemas define input/output fields for each action.
var actionSchemas = map[string]*endpoint.ActionSchema{
	"github.create_issue": {
		ActionID: "github.create_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "title", Label: "Title", DataType: "string", Required: true, Description: "Issue title"},
			{Name: "body", Label: "Body", DataType: "string", Required: false, Description: "Issue description"},
			{Name: "labels", Label: "Labels", DataType: "array", Required: false, Description: "Labels to add"},
			{Name: "assignees", Label: "Assignees", DataType: "array", Required: false, Description: "Users to assign"},
			{Name: "milestone", Label: "Milestone", DataType: "integer", Required: false, Description: "Milestone number"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "issueNumber", Label: "Issue Number", DataType: "integer", Description: "Created issue number"},
			{Name: "issueId", Label: "Issue ID", DataType: "string", Description: "Created issue ID"},
			{Name: "htmlUrl", Label: "HTML URL", DataType: "string", Description: "URL to view issue"},
		},
	},
	"github.update_issue": {
		ActionID: "github.update_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "issueNumber", Label: "Issue Number", DataType: "integer", Required: true, Description: "Issue number"},
			{Name: "title", Label: "Title", DataType: "string", Required: false, Description: "New title"},
			{Name: "body", Label: "Body", DataType: "string", Required: false, Description: "New description"},
			{Name: "state", Label: "State", DataType: "string", Required: false, Description: "State (open/closed)"},
			{Name: "labels", Label: "Labels", DataType: "array", Required: false, Description: "Labels to set"},
			{Name: "assignees", Label: "Assignees", DataType: "array", Required: false, Description: "Users to assign"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "success", Label: "Success", DataType: "boolean", Description: "Whether update succeeded"},
		},
	},
	"github.close_issue": {
		ActionID: "github.close_issue",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "issueNumber", Label: "Issue Number", DataType: "integer", Required: true, Description: "Issue number to close"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "success", Label: "Success", DataType: "boolean", Description: "Whether close succeeded"},
		},
	},
	"github.add_comment": {
		ActionID: "github.add_comment",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "issueNumber", Label: "Issue/PR Number", DataType: "integer", Required: true, Description: "Issue or PR number"},
			{Name: "body", Label: "Comment Body", DataType: "string", Required: true, Description: "Comment content"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "commentId", Label: "Comment ID", DataType: "string", Description: "Created comment ID"},
			{Name: "htmlUrl", Label: "HTML URL", DataType: "string", Description: "URL to view comment"},
		},
	},
	"github.create_pr": {
		ActionID: "github.create_pr",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "title", Label: "Title", DataType: "string", Required: true, Description: "PR title"},
			{Name: "body", Label: "Body", DataType: "string", Required: false, Description: "PR description"},
			{Name: "head", Label: "Head Branch", DataType: "string", Required: true, Description: "Branch containing changes"},
			{Name: "base", Label: "Base Branch", DataType: "string", Required: true, Description: "Branch to merge into"},
			{Name: "draft", Label: "Draft", DataType: "boolean", Required: false, Description: "Create as draft PR"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "prNumber", Label: "PR Number", DataType: "integer", Description: "Created PR number"},
			{Name: "prId", Label: "PR ID", DataType: "string", Description: "Created PR ID"},
			{Name: "htmlUrl", Label: "HTML URL", DataType: "string", Description: "URL to view PR"},
		},
	},
	"github.merge_pr": {
		ActionID: "github.merge_pr",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "prNumber", Label: "PR Number", DataType: "integer", Required: true, Description: "PR number to merge"},
			{Name: "commitTitle", Label: "Commit Title", DataType: "string", Required: false, Description: "Merge commit title"},
			{Name: "commitMessage", Label: "Commit Message", DataType: "string", Required: false, Description: "Merge commit message"},
			{Name: "mergeMethod", Label: "Merge Method", DataType: "string", Required: false, Description: "merge, squash, or rebase"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "sha", Label: "Merge Commit SHA", DataType: "string", Description: "SHA of merge commit"},
			{Name: "merged", Label: "Merged", DataType: "boolean", Description: "Whether PR was merged"},
		},
	},
	"github.add_labels": {
		ActionID: "github.add_labels",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "issueNumber", Label: "Issue/PR Number", DataType: "integer", Required: true, Description: "Issue or PR number"},
			{Name: "labels", Label: "Labels", DataType: "array", Required: true, Description: "Labels to add"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "labels", Label: "Labels", DataType: "array", Description: "All labels now on issue"},
		},
	},
	"github.assign_users": {
		ActionID: "github.assign_users",
		InputFields: []*endpoint.ActionField{
			{Name: "repo", Label: "Repository", DataType: "string", Required: true, Description: "Repository (owner/repo)"},
			{Name: "issueNumber", Label: "Issue/PR Number", DataType: "integer", Required: true, Description: "Issue or PR number"},
			{Name: "assignees", Label: "Assignees", DataType: "array", Required: true, Description: "Usernames to assign"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "assignees", Label: "Assignees", DataType: "array", Description: "All assignees now on issue"},
		},
	},
}

// =============================================================================
// ACTION ENDPOINT INTERFACE
// =============================================================================

// ListActions returns available GitHub actions.
func (g *GitHub) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return githubActions, nil
}

// GetActionSchema returns the schema for a specific action.
func (g *GitHub) GetActionSchema(ctx context.Context, actionID string) (*endpoint.ActionSchema, error) {
	schema, ok := actionSchemas[actionID]
	if !ok {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
	return schema, nil
}

// ExecuteAction executes a GitHub action.
func (g *GitHub) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	// Validate ActionID first
	switch req.ActionID {
	case "github.create_issue", "github.update_issue", "github.close_issue", "github.add_comment",
		"github.create_pr", "github.merge_pr", "github.add_labels", "github.assign_users":
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
	case "github.create_issue":
		return g.createIssue(ctx, req.Parameters)
	case "github.update_issue":
		return g.updateIssue(ctx, req.Parameters)
	case "github.close_issue":
		return g.closeIssue(ctx, req.Parameters)
	case "github.add_comment":
		return g.addComment(ctx, req.Parameters)
	case "github.create_pr":
		return g.createPR(ctx, req.Parameters)
	case "github.merge_pr":
		return g.mergePR(ctx, req.Parameters)
	case "github.add_labels":
		return g.addLabels(ctx, req.Parameters)
	case "github.assign_users":
		return g.assignUsers(ctx, req.Parameters)
	default:
		return nil, nil
	}
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

func (g *GitHub) createIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	title, _ := params["title"].(string)
	body, _ := params["body"].(string)

	if repo == "" || title == "" {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo and title are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo and title are required"}},
		}, nil
	}

	payload := map[string]any{"title": title}
	if body != "" {
		payload["body"] = body
	}
	if labels, ok := params["labels"].([]any); ok && len(labels) > 0 {
		payload["labels"] = labels
	}
	if assignees, ok := params["assignees"].([]any); ok && len(assignees) > 0 {
		payload["assignees"] = assignees
	}
	if milestone, ok := params["milestone"].(float64); ok && milestone > 0 {
		payload["milestone"] = int(milestone)
	}

	path := fmt.Sprintf("/repos/%s/issues", repo)
	resp, err := g.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to create issue: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID      int    `json:"id"`
		Number  int    `json:"number"`
		HTMLURL string `json:"html_url"`
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
		Message: fmt.Sprintf("Created issue #%d", result.Number),
		Data: map[string]any{
			"issueNumber": result.Number,
			"issueId":     fmt.Sprint(result.ID),
			"htmlUrl":     result.HTMLURL,
		},
	}, nil
}

func (g *GitHub) updateIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	issueNumber := getIntParam(params, "issueNumber")

	if repo == "" || issueNumber == 0 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo and issueNumber are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo and issueNumber are required"}},
		}, nil
	}

	payload := map[string]any{}
	if title, ok := params["title"].(string); ok && title != "" {
		payload["title"] = title
	}
	if body, ok := params["body"].(string); ok {
		payload["body"] = body
	}
	if state, ok := params["state"].(string); ok && state != "" {
		payload["state"] = state
	}
	if labels, ok := params["labels"].([]any); ok {
		payload["labels"] = labels
	}
	if assignees, ok := params["assignees"].([]any); ok {
		payload["assignees"] = assignees
	}

	path := fmt.Sprintf("/repos/%s/issues/%d", repo, issueNumber)
	_, err := g.Client.Patch(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to update issue: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Updated issue #%d", issueNumber),
		Data:    map[string]any{"success": true},
	}, nil
}

func (g *GitHub) closeIssue(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	params["state"] = "closed"
	return g.updateIssue(ctx, params)
}

func (g *GitHub) addComment(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	issueNumber := getIntParam(params, "issueNumber")
	body, _ := params["body"].(string)

	if repo == "" || issueNumber == 0 || body == "" {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo, issueNumber, and body are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo, issueNumber, and body are required"}},
		}, nil
	}

	payload := map[string]any{"body": body}
	path := fmt.Sprintf("/repos/%s/issues/%d/comments", repo, issueNumber)
	resp, err := g.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to add comment: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID      int    `json:"id"`
		HTMLURL string `json:"html_url"`
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
		Message: fmt.Sprintf("Added comment to #%d", issueNumber),
		Data: map[string]any{
			"commentId": fmt.Sprint(result.ID),
			"htmlUrl":   result.HTMLURL,
		},
	}, nil
}

func (g *GitHub) createPR(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	title, _ := params["title"].(string)
	head, _ := params["head"].(string)
	base, _ := params["base"].(string)

	if repo == "" || title == "" || head == "" || base == "" {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo, title, head, and base are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo, title, head, and base are required"}},
		}, nil
	}

	payload := map[string]any{
		"title": title,
		"head":  head,
		"base":  base,
	}
	if body, ok := params["body"].(string); ok {
		payload["body"] = body
	}
	if draft, ok := params["draft"].(bool); ok {
		payload["draft"] = draft
	}

	path := fmt.Sprintf("/repos/%s/pulls", repo)
	resp, err := g.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to create PR: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		ID      int    `json:"id"`
		Number  int    `json:"number"`
		HTMLURL string `json:"html_url"`
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
		Message: fmt.Sprintf("Created PR #%d", result.Number),
		Data: map[string]any{
			"prNumber": result.Number,
			"prId":     fmt.Sprint(result.ID),
			"htmlUrl":  result.HTMLURL,
		},
	}, nil
}

func (g *GitHub) mergePR(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	prNumber := getIntParam(params, "prNumber")

	if repo == "" || prNumber == 0 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo and prNumber are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo and prNumber are required"}},
		}, nil
	}

	payload := map[string]any{}
	if title, ok := params["commitTitle"].(string); ok && title != "" {
		payload["commit_title"] = title
	}
	if msg, ok := params["commitMessage"].(string); ok && msg != "" {
		payload["commit_message"] = msg
	}
	if method, ok := params["mergeMethod"].(string); ok && method != "" {
		payload["merge_method"] = method
	}

	path := fmt.Sprintf("/repos/%s/pulls/%d/merge", repo, prNumber)
	resp, err := g.Client.Put(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to merge PR: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		SHA    string `json:"sha"`
		Merged bool   `json:"merged"`
	}
	if err := resp.JSON(&result); err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to parse response",
			Errors:  []endpoint.ActionError{{Code: "PARSE_ERROR", Message: err.Error()}},
		}, nil
	}

	return &endpoint.ActionResult{
		Success: result.Merged,
		Message: fmt.Sprintf("Merged PR #%d", prNumber),
		Data: map[string]any{
			"sha":    result.SHA,
			"merged": result.Merged,
		},
	}, nil
}

func (g *GitHub) addLabels(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	issueNumber := getIntParam(params, "issueNumber")
	labels, _ := params["labels"].([]any)

	if repo == "" || issueNumber == 0 || len(labels) == 0 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo, issueNumber, and labels are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo, issueNumber, and labels are required"}},
		}, nil
	}

	payload := map[string]any{"labels": labels}
	path := fmt.Sprintf("/repos/%s/issues/%d/labels", repo, issueNumber)
	resp, err := g.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to add labels: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result []struct {
		Name string `json:"name"`
	}
	if err := resp.JSON(&result); err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to parse response",
			Errors:  []endpoint.ActionError{{Code: "PARSE_ERROR", Message: err.Error()}},
		}, nil
	}

	labelNames := make([]string, len(result))
	for i, l := range result {
		labelNames[i] = l.Name
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Added labels to #%d", issueNumber),
		Data:    map[string]any{"labels": labelNames},
	}, nil
}

func (g *GitHub) assignUsers(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	repo, _ := params["repo"].(string)
	issueNumber := getIntParam(params, "issueNumber")
	assignees, _ := params["assignees"].([]any)

	if repo == "" || issueNumber == 0 || len(assignees) == 0 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "repo, issueNumber, and assignees are required",
			Errors:  []endpoint.ActionError{{Code: "MISSING_FIELD", Message: "repo, issueNumber, and assignees are required"}},
		}, nil
	}

	payload := map[string]any{"assignees": assignees}
	path := fmt.Sprintf("/repos/%s/issues/%d/assignees", repo, issueNumber)
	resp, err := g.Client.Post(ctx, path, payload)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to assign users: %v", err),
			Errors:  []endpoint.ActionError{{Code: "API_ERROR", Message: err.Error()}},
		}, nil
	}

	var result struct {
		Assignees []struct {
			Login string `json:"login"`
		} `json:"assignees"`
	}
	if err := resp.JSON(&result); err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to parse response",
			Errors:  []endpoint.ActionError{{Code: "PARSE_ERROR", Message: err.Error()}},
		}, nil
	}

	usernames := make([]string, len(result.Assignees))
	for i, a := range result.Assignees {
		usernames[i] = a.Login
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Assigned users to #%d", issueNumber),
		Data:    map[string]any{"assignees": usernames},
	}, nil
}

// Helper to get int param from various types
func getIntParam(params map[string]any, key string) int {
	switch v := params[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return 0
}
