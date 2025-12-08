package jira

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Helper functions for action tests
func skipIfNoJiraAction(t *testing.T) {
	if os.Getenv("JIRA_BASE_URL") == "" || os.Getenv("JIRA_API_TOKEN") == "" {
		t.Skip("JIRA_BASE_URL or JIRA_API_TOKEN not set")
	}
}

func getJiraConfigForAction() map[string]any {
	return map[string]any{
		"baseUrl":  os.Getenv("JIRA_BASE_URL"),
		"email":    os.Getenv("JIRA_EMAIL"),
		"apiToken": os.Getenv("JIRA_API_TOKEN"),
		"jql":      "project IS NOT EMPTY ORDER BY updated DESC",
	}
}

// =============================================================================
// ACTION INTEGRATION TESTS
// =============================================================================

func TestJira_Action_Integration_CreateIssue(t *testing.T) {
	skipIfNoJiraAction(t)

	registry := endpoint.DefaultRegistry()
	config := getJiraConfigForAction()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()

	// Check ActionEndpoint
	actionEp, ok := ep.(endpoint.ActionEndpoint)
	if !ok {
		t.Fatal("Expected endpoint to implement ActionEndpoint")
	}

	// List available actions
	actions, err := actionEp.ListActions(ctx)
	if err != nil {
		t.Fatalf("ListActions failed: %v", err)
	}
	t.Logf("Available actions: %d", len(actions))
	for _, a := range actions {
		t.Logf("  [%s] %s - %s", a.Category, a.ID, a.Name)
	}

	// Get create_issue schema
	schema, err := actionEp.GetActionSchema(ctx, "jira.create_issue")
	if err != nil {
		t.Fatalf("GetActionSchema failed: %v", err)
	}
	t.Logf("create_issue input fields: %d", len(schema.InputFields))

	// Execute: Create Issue
	result, err := actionEp.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID: "jira.create_issue",
		Parameters: map[string]any{
			"projectKey":  "JIR", // Use JiraTracker test project
			"summary":     "[Test] UCL Action Test - " + os.Getenv("USER"),
			"description": "This issue was created by UCL ActionEndpoint integration test. Safe to delete.",
			"issueType":   "Task",
		},
	})
	if err != nil {
		t.Fatalf("ExecuteAction failed: %v", err)
	}

	if !result.Success {
		t.Errorf("Create issue failed: %s, errors: %+v", result.Message, result.Errors)
		return
	}

	issueKey := result.Data["issueKey"].(string)
	t.Logf("✅ Created issue: %s", issueKey)

	// Execute: Add Comment
	commentResult, err := actionEp.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID: "jira.add_comment",
		Parameters: map[string]any{
			"issueKey": issueKey,
			"body":     "This comment was added by UCL ActionEndpoint integration test.",
		},
	})
	if err != nil {
		t.Fatalf("add_comment failed: %v", err)
	}

	if commentResult.Success {
		t.Logf("✅ Added comment to %s", issueKey)
	} else {
		t.Errorf("Add comment failed: %s", commentResult.Message)
	}

	t.Logf("Issue lifecycle test complete. Issue %s was created and commented.", issueKey)
	t.Logf("⚠️  Please manually delete issue %s after verification", issueKey)
}

func TestJira_Action_Integration_DryRun(t *testing.T) {
	skipIfNoJiraAction(t)

	registry := endpoint.DefaultRegistry()
	config := getJiraConfigForAction()

	ep, err := registry.Create("http.jira", config)
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	actionEp := ep.(endpoint.ActionEndpoint)

	// DryRun should not create anything
	result, err := actionEp.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID: "jira.create_issue",
		Parameters: map[string]any{
			"projectKey": "SII",
			"summary":    "This should NOT be created",
			"issueType":  "Task",
		},
		DryRun: true,
	})
	if err != nil {
		t.Fatalf("DryRun failed: %v", err)
	}

	if !result.Success {
		t.Errorf("DryRun should succeed")
	}
	t.Logf("✅ DryRun validation passed: %s", result.Message)
}
