package github

import (
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Dataset catalog definitions for GitHub connector.
// Follows the same pattern as Jira: projects, users, issues, comments, worklogs.

// DatasetDef defines a GitHub dataset's metadata and schema.
type DatasetDef struct {
	ID                  string
	Name                string
	Entity              string
	Description         string
	StaticFields        []FieldDef
	APIPath             string
	SupportsIncremental bool
	IncrementalCursor   string
	Handler             string
}

// FieldDef defines a field in a dataset schema.
type FieldDef struct {
	Name     string
	DataType string
	Nullable bool
}

// All GitHub datasets.
var githubDatasets = map[string]DatasetDef{
	"github.repos": {
		ID:          "github.repos",
		Name:        "GitHub Repositories",
		Entity:      "repo",
		Description: "GitHub repositories accessible to the authenticated user or specified in config.",
		StaticFields: []FieldDef{
			{Name: "repoId", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "fullName", DataType: "STRING", Nullable: false},
			{Name: "owner", DataType: "STRING", Nullable: false},
			{Name: "defaultBranch", DataType: "STRING", Nullable: true},
			{Name: "visibility", DataType: "STRING", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "apiUrl", DataType: "STRING", Nullable: true},
			{Name: "language", DataType: "STRING", Nullable: true},
			{Name: "stargazersCount", DataType: "INTEGER", Nullable: true},
			{Name: "forksCount", DataType: "INTEGER", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}",
		SupportsIncremental: true,
		IncrementalCursor:   "updatedAt",
		Handler:             "repos",
	},
	"github.issues": {
		ID:          "github.issues",
		Name:        "GitHub Issues",
		Entity:      "issue",
		Description: "Issues in GitHub repositories (bugs, features, tasks).",
		StaticFields: []FieldDef{
			{Name: "issueId", DataType: "STRING", Nullable: false},
			{Name: "number", DataType: "INTEGER", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "title", DataType: "STRING", Nullable: false},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "state", DataType: "STRING", Nullable: false},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "assignees", DataType: "ARRAY", Nullable: true},
			{Name: "labels", DataType: "ARRAY", Nullable: true},
			{Name: "milestone", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "commentsCount", DataType: "INTEGER", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "closedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/issues",
		SupportsIncremental: true,
		IncrementalCursor:   "updatedAt",
		Handler:             "issues",
	},
	"github.pull_requests": {
		ID:          "github.pull_requests",
		Name:        "GitHub Pull Requests",
		Entity:      "pull_request",
		Description: "Pull requests in GitHub repositories.",
		StaticFields: []FieldDef{
			{Name: "prId", DataType: "STRING", Nullable: false},
			{Name: "number", DataType: "INTEGER", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "title", DataType: "STRING", Nullable: false},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "state", DataType: "STRING", Nullable: false},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "assignees", DataType: "ARRAY", Nullable: true},
			{Name: "labels", DataType: "ARRAY", Nullable: true},
			{Name: "headBranch", DataType: "STRING", Nullable: true},
			{Name: "baseBranch", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "merged", DataType: "BOOLEAN", Nullable: true},
			{Name: "mergedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "mergedBy", DataType: "STRING", Nullable: true},
			{Name: "commitsCount", DataType: "INTEGER", Nullable: true},
			{Name: "changedFilesCount", DataType: "INTEGER", Nullable: true},
			{Name: "additions", DataType: "INTEGER", Nullable: true},
			{Name: "deletions", DataType: "INTEGER", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "closedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/pulls",
		SupportsIncremental: true,
		IncrementalCursor:   "updatedAt",
		Handler:             "pull_requests",
	},
	"github.commits": {
		ID:          "github.commits",
		Name:        "GitHub Commits",
		Entity:      "commit",
		Description: "Commits in GitHub repositories.",
		StaticFields: []FieldDef{
			{Name: "sha", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "message", DataType: "STRING", Nullable: true},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "authorEmail", DataType: "STRING", Nullable: true},
			{Name: "committer", DataType: "STRING", Nullable: true},
			{Name: "committerEmail", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "parents", DataType: "ARRAY", Nullable: true},
			{Name: "additionsCount", DataType: "INTEGER", Nullable: true},
			{Name: "deletionsCount", DataType: "INTEGER", Nullable: true},
			{Name: "filesChangedCount", DataType: "INTEGER", Nullable: true},
			{Name: "committedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/commits",
		SupportsIncremental: true,
		IncrementalCursor:   "committedAt",
		Handler:             "commits",
	},
	"github.comments": {
		ID:          "github.comments",
		Name:        "GitHub Comments",
		Entity:      "comment",
		Description: "Comments on issues and pull requests.",
		StaticFields: []FieldDef{
			{Name: "commentId", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "issueNumber", DataType: "INTEGER", Nullable: true},
			{Name: "prNumber", DataType: "INTEGER", Nullable: true},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/issues/comments",
		SupportsIncremental: true,
		IncrementalCursor:   "updatedAt",
		Handler:             "comments",
	},
	"github.reviews": {
		ID:          "github.reviews",
		Name:        "GitHub PR Reviews",
		Entity:      "review",
		Description: "Code reviews on pull requests.",
		StaticFields: []FieldDef{
			{Name: "reviewId", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "prNumber", DataType: "INTEGER", Nullable: false},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "state", DataType: "STRING", Nullable: true},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "submittedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
		SupportsIncremental: false,
		Handler:             "reviews",
	},
	"github.releases": {
		ID:          "github.releases",
		Name:        "GitHub Releases",
		Entity:      "release",
		Description: "Releases in GitHub repositories.",
		StaticFields: []FieldDef{
			{Name: "releaseId", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "tagName", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: true},
			{Name: "body", DataType: "STRING", Nullable: true},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "draft", DataType: "BOOLEAN", Nullable: true},
			{Name: "prerelease", DataType: "BOOLEAN", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "tarballUrl", DataType: "STRING", Nullable: true},
			{Name: "zipballUrl", DataType: "STRING", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "publishedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/releases",
		SupportsIncremental: false,
		Handler:             "releases",
	},
	"github.files": {
		ID:          "github.files",
		Name:        "GitHub Code Files",
		Entity:      "file",
		Description: "Code files in GitHub repositories.",
		StaticFields: []FieldDef{
			{Name: "path", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "sha", DataType: "STRING", Nullable: false},
			{Name: "size", DataType: "INTEGER", Nullable: true},
			{Name: "language", DataType: "STRING", Nullable: true},
			{Name: "htmlUrl", DataType: "STRING", Nullable: true},
			{Name: "contentText", DataType: "STRING", Nullable: true},
		},
		APIPath:             "/repos/{owner}/{repo}/git/trees/{branch}",
		SupportsIncremental: false,
		Handler:             "files",
	},
	"github.file_chunks": {
		ID:          "github.file_chunks",
		Name:        "GitHub Code Chunks",
		Entity:      "file_chunk",
		Description: "Chunked code content for vector indexing.",
		StaticFields: []FieldDef{
			{Name: "path", DataType: "STRING", Nullable: false},
			{Name: "repo", DataType: "STRING", Nullable: false},
			{Name: "sha", DataType: "STRING", Nullable: false},
			{Name: "chunkIndex", DataType: "INTEGER", Nullable: false},
			{Name: "text", DataType: "STRING", Nullable: false},
		},
		APIPath:             "",
		SupportsIncremental: false,
		Handler:             "file_chunks",
	},
	"github.api_surface": {
		ID:          "github.api_surface",
		Name:        "GitHub API Surface",
		Entity:      "api_surface",
		Description: "Inventory of REST APIs leveraged by Nucleus for GitHub. Useful for agentic discovery.",
		StaticFields: []FieldDef{
			{Name: "key", DataType: "STRING", Nullable: false},
			{Name: "method", DataType: "STRING", Nullable: false},
			{Name: "path", DataType: "STRING", Nullable: false},
			{Name: "scope", DataType: "STRING", Nullable: true},
			{Name: "category", DataType: "STRING", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
			{Name: "docUrl", DataType: "STRING", Nullable: true},
		},
		APIPath:             "",
		SupportsIncremental: false,
		Handler:             "api_surface",
	},
}

// GetDatasetDef returns the definition for a dataset.
func GetDatasetDef(datasetID string) (DatasetDef, bool) {
	def, ok := githubDatasets[datasetID]
	return def, ok
}

// AllDatasetDefs returns all dataset definitions.
func AllDatasetDefs() map[string]DatasetDef {
	return githubDatasets
}

// BuildDatasetSchema converts a DatasetDef to an endpoint.Schema.
func BuildDatasetSchema(def DatasetDef) *endpoint.Schema {
	fields := make([]*endpoint.FieldDefinition, len(def.StaticFields))
	for i, f := range def.StaticFields {
		fields[i] = &endpoint.FieldDefinition{
			Name:     f.Name,
			DataType: f.DataType,
			Nullable: f.Nullable,
			Position: i + 1,
		}
	}
	return &endpoint.Schema{Fields: fields}
}
