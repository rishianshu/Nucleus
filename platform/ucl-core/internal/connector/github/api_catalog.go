package github

import (
	"context"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// API LIBRARY
// Catalog of GitHub REST APIs used by this connector for metadata richness
// and agentic discovery.
// =============================================================================

// APIEndpoint describes a GitHub API endpoint.
type APIEndpoint struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	Description string `json:"description"`
	DocsURL     string `json:"docUrl"`
	Scope       string `json:"scope"`
	Category    string `json:"category"` // read, write, admin
}

// APILibrary is the catalog of GitHub APIs leveraged by Nucleus.
var APILibrary = map[string]APIEndpoint{
	// Authentication & User
	"user_authenticated": {
		Method:      "GET",
		Path:        "/user",
		Description: "Get the authenticated user",
		DocsURL:     "https://docs.github.com/en/rest/users/users#get-the-authenticated-user",
		Scope:       "user",
		Category:    "read",
	},

	// Repositories
	"repo_list_user": {
		Method:      "GET",
		Path:        "/user/repos",
		Description: "List repositories for the authenticated user",
		DocsURL:     "https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user",
		Scope:       "repos",
		Category:    "read",
	},
	"repo_get": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}",
		Description: "Get a repository",
		DocsURL:     "https://docs.github.com/en/rest/repos/repos#get-a-repository",
		Scope:       "repos",
		Category:    "read",
	},

	// Git Trees & Contents
	"git_tree": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/git/trees/{tree_sha}",
		Description: "Get a tree (file listing) recursively",
		DocsURL:     "https://docs.github.com/en/rest/git/trees#get-a-tree",
		Scope:       "files",
		Category:    "read",
	},
	"content_get": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/contents/{path}",
		Description: "Get file contents (base64 encoded)",
		DocsURL:     "https://docs.github.com/en/rest/repos/contents#get-repository-content",
		Scope:       "files",
		Category:    "read",
	},

	// Issues
	"issues_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/issues",
		Description: "List issues for a repository",
		DocsURL:     "https://docs.github.com/en/rest/issues/issues#list-repository-issues",
		Scope:       "issues",
		Category:    "read",
	},
	"issue_get": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/issues/{issue_number}",
		Description: "Get a specific issue",
		DocsURL:     "https://docs.github.com/en/rest/issues/issues#get-an-issue",
		Scope:       "issues",
		Category:    "read",
	},
	"issue_create": {
		Method:      "POST",
		Path:        "/repos/{owner}/{repo}/issues",
		Description: "Create an issue",
		DocsURL:     "https://docs.github.com/en/rest/issues/issues#create-an-issue",
		Scope:       "issues",
		Category:    "write",
	},
	"issue_update": {
		Method:      "PATCH",
		Path:        "/repos/{owner}/{repo}/issues/{issue_number}",
		Description: "Update an issue",
		DocsURL:     "https://docs.github.com/en/rest/issues/issues#update-an-issue",
		Scope:       "issues",
		Category:    "write",
	},

	// Issue Comments
	"comments_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/issues/comments",
		Description: "List issue comments for a repository",
		DocsURL:     "https://docs.github.com/en/rest/issues/comments#list-issue-comments-for-a-repository",
		Scope:       "comments",
		Category:    "read",
	},
	"comment_create": {
		Method:      "POST",
		Path:        "/repos/{owner}/{repo}/issues/{issue_number}/comments",
		Description: "Create an issue comment",
		DocsURL:     "https://docs.github.com/en/rest/issues/comments#create-an-issue-comment",
		Scope:       "comments",
		Category:    "write",
	},

	// Issue Labels
	"labels_add": {
		Method:      "POST",
		Path:        "/repos/{owner}/{repo}/issues/{issue_number}/labels",
		Description: "Add labels to an issue",
		DocsURL:     "https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue",
		Scope:       "labels",
		Category:    "write",
	},

	// Issue Assignees
	"assignees_add": {
		Method:      "POST",
		Path:        "/repos/{owner}/{repo}/issues/{issue_number}/assignees",
		Description: "Add assignees to an issue",
		DocsURL:     "https://docs.github.com/en/rest/issues/assignees#add-assignees-to-an-issue",
		Scope:       "assignees",
		Category:    "write",
	},

	// Pull Requests
	"pulls_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/pulls",
		Description: "List pull requests",
		DocsURL:     "https://docs.github.com/en/rest/pulls/pulls#list-pull-requests",
		Scope:       "pulls",
		Category:    "read",
	},
	"pull_get": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/pulls/{pull_number}",
		Description: "Get a pull request",
		DocsURL:     "https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request",
		Scope:       "pulls",
		Category:    "read",
	},
	"pull_create": {
		Method:      "POST",
		Path:        "/repos/{owner}/{repo}/pulls",
		Description: "Create a pull request",
		DocsURL:     "https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request",
		Scope:       "pulls",
		Category:    "write",
	},
	"pull_merge": {
		Method:      "PUT",
		Path:        "/repos/{owner}/{repo}/pulls/{pull_number}/merge",
		Description: "Merge a pull request",
		DocsURL:     "https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request",
		Scope:       "pulls",
		Category:    "write",
	},

	// Pull Request Reviews
	"reviews_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
		Description: "List reviews on a pull request",
		DocsURL:     "https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request",
		Scope:       "reviews",
		Category:    "read",
	},

	// Commits
	"commits_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/commits",
		Description: "List commits",
		DocsURL:     "https://docs.github.com/en/rest/commits/commits#list-commits",
		Scope:       "commits",
		Category:    "read",
	},
	"commit_get": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/commits/{ref}",
		Description: "Get a commit",
		DocsURL:     "https://docs.github.com/en/rest/commits/commits#get-a-commit",
		Scope:       "commits",
		Category:    "read",
	},

	// Releases
	"releases_list": {
		Method:      "GET",
		Path:        "/repos/{owner}/{repo}/releases",
		Description: "List releases",
		DocsURL:     "https://docs.github.com/en/rest/releases/releases#list-releases",
		Scope:       "releases",
		Category:    "read",
	},

	// Rate Limit
	"rate_limit": {
		Method:      "GET",
		Path:        "/rate_limit",
		Description: "Get rate limit status for the authenticated user",
		DocsURL:     "https://docs.github.com/en/rest/rate-limit/rate-limit#get-rate-limit-status-for-the-authenticated-user",
		Scope:       "system",
		Category:    "read",
	},
}

// =============================================================================
// API SURFACE DATASET
// =============================================================================

// ListAPIs returns the API surface as endpoint.ActionDescriptor-like records.
// This can be used by agents to discover and use APIs.
func (g *GitHub) ListAPIs(ctx context.Context) ([]APIEndpoint, error) {
	apis := make([]APIEndpoint, 0, len(APILibrary))
	for _, api := range APILibrary {
		apis = append(apis, api)
	}
	return apis, nil
}

// handleAPISurface returns the API catalog as records.
func (g *GitHub) handleAPISurface(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	records := make([]endpoint.Record, 0, len(APILibrary))
	for key, api := range APILibrary {
		records = append(records, endpoint.Record{
			"key":         key,
			"method":      api.Method,
			"path":        api.Path,
			"scope":       api.Scope,
			"category":    api.Category,
			"description": api.Description,
			"docUrl":      api.DocsURL,
		})
	}
	return &recordIterator{records: records}, nil
}
