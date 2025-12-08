package jira

import "github.com/nucleus/ucl-core/internal/core/cdm"

// =============================================================================
// API LIBRARY
// Catalog of Jira REST API endpoints used by this connector.
// =============================================================================

// APIEndpoint describes a Jira REST API endpoint.
type APIEndpoint struct {
	Method      string
	Path        string
	Description string
	DocsURL     string
	Scope       string
}

// APILibrary contains all Jira API endpoints used by this connector.
var APILibrary = map[string]APIEndpoint{
	"project_search": {
		Method:      "GET",
		Path:        "/rest/api/3/project/search",
		Description: "List projects visible to the authenticated user",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get",
		Scope:       "projects",
	},
	"project_detail": {
		Method:      "GET",
		Path:        "/rest/api/3/project/{projectIdOrKey}",
		Description: "Fetch project metadata and configuration",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-projectidorkey-get",
		Scope:       "projects",
	},
	"issue_search": {
		Method:      "GET",
		Path:        "/rest/api/3/search/jql",
		Description: "Search issues via JQL with pagination",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-post",
		Scope:       "issues",
	},
	"issue_detail": {
		Method:      "GET",
		Path:        "/rest/api/3/issue/{issueIdOrKey}",
		Description: "Retrieve a single issue with selected fields",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get",
		Scope:       "issues",
	},
	"field_catalog": {
		Method:      "GET",
		Path:        "/rest/api/3/field",
		Description: "Enumerate built-in and custom fields",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get",
		Scope:       "issues",
	},
	"user_search": {
		Method:      "GET",
		Path:        "/rest/api/3/user/search",
		Description: "Search users by query",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-users/#api-rest-api-3-user-search-get",
		Scope:       "users",
	},
	"status_list": {
		Method:      "GET",
		Path:        "/rest/api/3/status",
		Description: "List configured workflow statuses",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-statuses/#api-rest-api-3-status-get",
		Scope:       "statuses",
	},
	"priority_list": {
		Method:      "GET",
		Path:        "/rest/api/3/priority",
		Description: "List configured priorities",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-priorities/#api-rest-api-3-priority-get",
		Scope:       "priorities",
	},
	"issuetype_list": {
		Method:      "GET",
		Path:        "/rest/api/3/issuetype",
		Description: "List issue types (standard + sub-task)",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-types/#api-rest-api-3-issuetype-get",
		Scope:       "issue_types",
	},
	"issue_comments": {
		Method:      "GET",
		Path:        "/rest/api/3/issue/{issueIdOrKey}/comment",
		Description: "List all comments on an issue",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-get",
		Scope:       "comments",
	},
	"issue_worklogs": {
		Method:      "GET",
		Path:        "/rest/api/3/issue/{issueIdOrKey}/worklog",
		Description: "Retrieve worklogs recorded against an issue",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-worklogs/#api-rest-api-3-issue-issueidorkey-worklog-get",
		Scope:       "worklogs",
	},
	"server_info": {
		Method:      "GET",
		Path:        "/rest/api/3/serverInfo",
		Description: "Get Jira server version and configuration",
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-server-info/",
		Scope:       "system",
	},
}

// =============================================================================
// FIELD DEFINITIONS
// Schema field definitions for each dataset.
// =============================================================================

// FieldDef defines a schema field.
type FieldDef struct {
	Name     string
	DataType string
	Nullable bool
	Comment  string
}

// =============================================================================
// DATASET DEFINITIONS
// Catalog of available datasets with their schemas and ingestion config.
// =============================================================================

// DatasetDefinition defines a dataset's metadata and ingestion behavior.
type DatasetDefinition struct {
	Name                string
	Entity              string
	Description         string
	StaticFields        []FieldDef
	APIKeys             []string
	SupportsIncremental bool
	IncrementalCursor   string
	Handler             string
	CdmModelID          string // Optional - only if CDM mapping available
}

// DatasetDefinitions contains all Jira dataset definitions.
var DatasetDefinitions = map[string]DatasetDefinition{
	"jira.projects": {
		Name:        "Jira Projects",
		Entity:      "projects",
		Description: "Projects visible to the configured credentials.",
		StaticFields: []FieldDef{
			{Name: "projectKey", DataType: "STRING", Nullable: false, Comment: "Project key (e.g. ENG)."},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "projectType", DataType: "STRING", Nullable: true},
			{Name: "lead", DataType: "STRING", Nullable: true, Comment: "Display name for the project lead."},
			{Name: "url", DataType: "STRING", Nullable: true, Comment: "Project browse URL."},
			{Name: "description", DataType: "STRING", Nullable: true},
		},
		APIKeys:             []string{"project_search", "project_detail"},
		SupportsIncremental: false,
		Handler:             "projects",
		CdmModelID:          cdm.ModelWorkProject,
	},
	"jira.issues": {
		Name:        "Jira Issues",
		Entity:      "issues",
		Description: "Work items synchronized from Jira (issues, epics, tasks, subtasks).",
		StaticFields: []FieldDef{
			{Name: "issueKey", DataType: "STRING", Nullable: false},
			{Name: "summary", DataType: "STRING", Nullable: true},
			{Name: "status", DataType: "STRING", Nullable: true},
			{Name: "projectKey", DataType: "STRING", Nullable: false},
			{Name: "issueType", DataType: "STRING", Nullable: true},
			{Name: "assignee", DataType: "STRING", Nullable: true},
			{Name: "reporter", DataType: "STRING", Nullable: true},
			{Name: "priority", DataType: "STRING", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIKeys:             []string{"issue_search", "issue_detail", "field_catalog"},
		SupportsIncremental: true,
		IncrementalCursor:   "fields.updated",
		Handler:             "issues",
		CdmModelID:          cdm.ModelWorkItem,
	},
	"jira.users": {
		Name:        "Jira Users",
		Entity:      "users",
		Description: "Directory of Jira users referenced by work items.",
		StaticFields: []FieldDef{
			{Name: "accountId", DataType: "STRING", Nullable: false},
			{Name: "displayName", DataType: "STRING", Nullable: false},
			{Name: "email", DataType: "STRING", Nullable: true},
			{Name: "timeZone", DataType: "STRING", Nullable: true},
			{Name: "active", DataType: "BOOLEAN", Nullable: true},
		},
		APIKeys:             []string{"user_search"},
		SupportsIncremental: false,
		Handler:             "users",
		CdmModelID:          cdm.ModelWorkUser,
	},
	"jira.issue_types": {
		Name:        "Jira Issue Types",
		Entity:      "issue_types",
		Description: "Catalog of configured Jira issue types.",
		StaticFields: []FieldDef{
			{Name: "typeId", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "hierarchyLevel", DataType: "INTEGER", Nullable: true},
			{Name: "subtask", DataType: "BOOLEAN", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
		},
		APIKeys:             []string{"issuetype_list"},
		SupportsIncremental: false,
		Handler:             "issue_types",
	},
	"jira.statuses": {
		Name:        "Jira Statuses",
		Entity:      "statuses",
		Description: "Workflow statuses available to the Jira tenant.",
		StaticFields: []FieldDef{
			{Name: "statusId", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "category", DataType: "STRING", Nullable: true},
			{Name: "categoryKey", DataType: "STRING", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
		},
		APIKeys:             []string{"status_list"},
		SupportsIncremental: false,
		Handler:             "statuses",
	},
	"jira.priorities": {
		Name:        "Jira Priorities",
		Entity:      "priorities",
		Description: "Priority levels configured in Jira.",
		StaticFields: []FieldDef{
			{Name: "priorityId", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "description", DataType: "STRING", Nullable: true},
			{Name: "color", DataType: "STRING", Nullable: true},
		},
		APIKeys:             []string{"priority_list"},
		SupportsIncremental: false,
		Handler:             "priorities",
	},
	"jira.comments": {
		Name:        "Jira Comments",
		Entity:      "comments",
		Description: "User conversations/comments attached to Jira issues.",
		StaticFields: []FieldDef{
			{Name: "commentId", DataType: "STRING", Nullable: false},
			{Name: "issueKey", DataType: "STRING", Nullable: false},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIKeys:             []string{"issue_comments"},
		SupportsIncremental: true,
		IncrementalCursor:   "updated",
		Handler:             "comments",
		CdmModelID:          cdm.ModelWorkComment,
	},
	"jira.worklogs": {
		Name:        "Jira Worklogs",
		Entity:      "worklogs",
		Description: "Time tracking entries recorded against issues.",
		StaticFields: []FieldDef{
			{Name: "worklogId", DataType: "STRING", Nullable: false},
			{Name: "issueKey", DataType: "STRING", Nullable: false},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "timeSpentSeconds", DataType: "INTEGER", Nullable: true},
			{Name: "startedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIKeys:             []string{"issue_worklogs"},
		SupportsIncremental: true,
		IncrementalCursor:   "started",
		Handler:             "worklogs",
		CdmModelID:          cdm.ModelWorkLog,
	},
	"jira.api_surface": {
		Name:        "Jira API Surface",
		Entity:      "api_surface",
		Description: "Inventory of REST APIs leveraged by Nucleus for Jira.",
		StaticFields: []FieldDef{
			{Name: "method", DataType: "STRING", Nullable: false},
			{Name: "path", DataType: "STRING", Nullable: false},
			{Name: "scope", DataType: "STRING", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
			{Name: "docUrl", DataType: "STRING", Nullable: true},
		},
		APIKeys: []string{
			"project_search", "issue_search", "user_search",
			"status_list", "priority_list", "issuetype_list",
			"issue_comments", "issue_worklogs",
		},
		SupportsIncremental: false,
		Handler:             "api_surface",
	},
}

// GetDatasetIDs returns all available dataset IDs.
func GetDatasetIDs() []string {
	ids := make([]string, 0, len(DatasetDefinitions))
	for id := range DatasetDefinitions {
		ids = append(ids, id)
	}
	return ids
}

// GetIngestionDatasets returns datasets that support ingestion.
func GetIngestionDatasets() []string {
	var ids []string
	for id, def := range DatasetDefinitions {
		if def.Handler != "" && def.Handler != "api_surface" {
			ids = append(ids, id)
		}
	}
	return ids
}
