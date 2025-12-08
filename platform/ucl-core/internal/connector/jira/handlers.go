package jira

import (
	"context"
	"fmt"
	"net/url"
	"strconv"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// INGESTION HANDLERS
// Per-dataset handlers that fetch data from Jira API.
// =============================================================================

// handleProjects fetches all accessible projects.
func (j *Jira) handleProjects(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	var projects []*Project
	err := j.FetchJSON(ctx, "/rest/api/3/project", &projects)
	if err != nil {
		return nil, fmt.Errorf("fetch projects: %w", err)
	}

	records := make([]endpoint.Record, 0, len(projects))
	for _, p := range projects {
		lead := ""
		if p.Lead != nil {
			lead = p.Lead.DisplayName
		}
		records = append(records, endpoint.Record{
			"projectKey":  p.Key,
			"name":        p.Name,
			"projectType": p.ProjectTypeKey,
			"lead":        lead,
			"url":         p.Self,
			"description": p.Description,
			"_raw":        p, // Keep raw for CDM mapper
		})
	}

	return &sliceIterator{records: records, limit: int(req.Limit)}, nil
}

// handleUsers fetches all accessible users.
func (j *Jira) handleUsers(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	query := url.Values{}
	query.Set("maxResults", "1000")

	resp, err := j.Client.Get(ctx, "/rest/api/3/users/search", query)
	if err != nil {
		return nil, fmt.Errorf("fetch users: %w", err)
	}

	var users []*User
	if err := resp.JSON(&users); err != nil {
		return nil, fmt.Errorf("parse users: %w", err)
	}

	records := make([]endpoint.Record, 0, len(users))
	for _, u := range users {
		records = append(records, endpoint.Record{
			"accountId":   u.AccountID,
			"displayName": u.DisplayName,
			"email":       u.EmailAddress,
			"timeZone":    u.TimeZone,
			"active":      u.Active,
			"_raw":        u,
		})
	}

	return &sliceIterator{records: records, limit: int(req.Limit)}, nil
}

// handleIssues fetches issues using JQL with pagination.
func (j *Jira) handleIssues(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	jql := j.buildJQL(req)

	return &issueIterator{
		jira:       j,
		ctx:        ctx,
		jql:        jql,
		fetchSize:  j.config.FetchSize,
		maxResults: int(req.Limit),
	}, nil
}

// handleIssueTypes fetches issue type catalog.
func (j *Jira) handleIssueTypes(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	var issueTypes []struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		HierarchyLevel int    `json:"hierarchyLevel"`
		Subtask        bool   `json:"subtask"`
		Description    string `json:"description"`
	}

	if err := j.FetchJSON(ctx, "/rest/api/3/issuetype", &issueTypes); err != nil {
		return nil, fmt.Errorf("fetch issue types: %w", err)
	}

	records := make([]endpoint.Record, 0, len(issueTypes))
	for _, it := range issueTypes {
		records = append(records, endpoint.Record{
			"typeId":         it.ID,
			"name":           it.Name,
			"hierarchyLevel": it.HierarchyLevel,
			"subtask":        it.Subtask,
			"description":    it.Description,
		})
	}

	return &sliceIterator{records: records, limit: int(req.Limit)}, nil
}

// handleStatuses fetches workflow statuses.
func (j *Jira) handleStatuses(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	var statuses []struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		StatusCategory struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"statusCategory"`
		Description string `json:"description"`
	}

	if err := j.FetchJSON(ctx, "/rest/api/3/status", &statuses); err != nil {
		return nil, fmt.Errorf("fetch statuses: %w", err)
	}

	records := make([]endpoint.Record, 0, len(statuses))
	for _, s := range statuses {
		records = append(records, endpoint.Record{
			"statusId":    s.ID,
			"name":        s.Name,
			"category":    s.StatusCategory.Name,
			"categoryKey": s.StatusCategory.Key,
			"description": s.Description,
		})
	}

	return &sliceIterator{records: records, limit: int(req.Limit)}, nil
}

// handlePriorities fetches priority levels.
func (j *Jira) handlePriorities(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	var priorities []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		StatusColor string `json:"statusColor"`
	}

	if err := j.FetchJSON(ctx, "/rest/api/3/priority", &priorities); err != nil {
		return nil, fmt.Errorf("fetch priorities: %w", err)
	}

	records := make([]endpoint.Record, 0, len(priorities))
	for _, p := range priorities {
		records = append(records, endpoint.Record{
			"priorityId":  p.ID,
			"name":        p.Name,
			"description": p.Description,
			"color":       p.StatusColor,
		})
	}

	return &sliceIterator{records: records, limit: int(req.Limit)}, nil
}

// handleComments fetches comments for all issues.
// This iterates through issues and fetches their comments.
func (j *Jira) handleComments(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	// Build JQL for issues that have comments
	jql := j.buildJQL(req)
	if jql == "" {
		jql = "ORDER BY updated DESC"
	}

	return &commentIterator{
		jira:      j,
		ctx:       ctx,
		jql:       jql,
		fetchSize: j.config.FetchSize,
		maxTotal:  int(req.Limit),
	}, nil
}

// handleWorklogs fetches worklogs for all issues.
func (j *Jira) handleWorklogs(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	jql := j.buildJQL(req)
	if jql == "" {
		jql = "ORDER BY updated DESC"
	}

	return &worklogIterator{
		jira:      j,
		ctx:       ctx,
		jql:       jql,
		fetchSize: j.config.FetchSize,
		maxTotal:  int(req.Limit),
	}, nil
}

// handleAPISurface returns the API catalog as records.
func (j *Jira) handleAPISurface(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	records := make([]endpoint.Record, 0, len(APILibrary))
	for _, api := range APILibrary {
		records = append(records, endpoint.Record{
			"method":      api.Method,
			"path":        api.Path,
			"scope":       api.Scope,
			"description": api.Description,
			"docUrl":      api.DocsURL,
		})
	}
	return &sliceIterator{records: records}, nil
}

// =============================================================================
// COMMENT ITERATOR
// Iterates issues and fetches comments for each.
// =============================================================================

type commentIterator struct {
	jira      *Jira
	ctx       context.Context
	jql       string
	fetchSize int
	maxTotal  int

	// Issue pagination
	issueStartAt int
	issueTotal   int
	issues       []*Issue
	issueIdx     int

	// Comment buffer
	comments   []endpoint.Record
	commentIdx int

	done bool
	err  error
}

func (it *commentIterator) Next() bool {
	// Check limit
	if it.maxTotal > 0 && it.commentIdx >= it.maxTotal {
		return false
	}

	// Return buffered comment if available
	if it.commentIdx < len(it.comments) {
		return true
	}

	if it.done {
		return false
	}

	// Fetch comments for next issue
	for {
		// Need more issues?
		if it.issueIdx >= len(it.issues) {
			if it.issueStartAt >= it.issueTotal && it.issueTotal > 0 {
				it.done = true
				return false
			}
			if err := it.fetchIssues(); err != nil {
				it.err = err
				return false
			}
			if len(it.issues) == 0 {
				it.done = true
				return false
			}
		}

		// Fetch comments for current issue
		issue := it.issues[it.issueIdx]
		it.issueIdx++

		comments, err := it.fetchCommentsForIssue(issue.Key)
		if err != nil {
			it.err = err
			return false
		}

		if len(comments) > 0 {
			it.comments = comments
			it.commentIdx = 0
			return true
		}
	}
}

func (it *commentIterator) fetchIssues() error {
	query := url.Values{}
	query.Set("jql", it.jql)
	query.Set("startAt", strconv.Itoa(it.issueStartAt))
	query.Set("maxResults", strconv.Itoa(it.fetchSize))
	query.Set("fields", "key")

	resp, err := it.jira.Client.Get(it.ctx, "/rest/api/3/search/jql", query)
	if err != nil {
		return err
	}

	var result SearchResult
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.issueTotal = result.Total
	it.issues = result.Issues
	it.issueIdx = 0
	it.issueStartAt += len(result.Issues)
	return nil
}

func (it *commentIterator) fetchCommentsForIssue(issueKey string) ([]endpoint.Record, error) {
	path := fmt.Sprintf("/rest/api/3/issue/%s/comment", issueKey)
	resp, err := it.jira.Client.Get(it.ctx, path, nil)
	if err != nil {
		return nil, err
	}

	var result CommentsResponse
	if err := resp.JSON(&result); err != nil {
		return nil, err
	}

	records := make([]endpoint.Record, 0, len(result.Comments))
	for _, c := range result.Comments {
		author := ""
		if c.Author != nil {
			author = c.Author.DisplayName
		}
		records = append(records, endpoint.Record{
			"commentId": c.ID,
			"issueKey":  issueKey,
			"author":    author,
			"body":      bodyToString(c.Body),
			"createdAt": c.Created,
			"updatedAt": c.Updated,
			"_raw":      c,
		})
	}
	return records, nil
}

func (it *commentIterator) Value() endpoint.Record {
	if it.commentIdx < len(it.comments) {
		rec := it.comments[it.commentIdx]
		it.commentIdx++
		return rec
	}
	return nil
}

func (it *commentIterator) Err() error  { return it.err }
func (it *commentIterator) Close() error { return nil }

// =============================================================================
// WORKLOG ITERATOR
// Iterates issues and fetches worklogs for each.
// =============================================================================

type worklogIterator struct {
	jira      *Jira
	ctx       context.Context
	jql       string
	fetchSize int
	maxTotal  int

	issueStartAt int
	issueTotal   int
	issues       []*Issue
	issueIdx     int

	worklogs   []endpoint.Record
	worklogIdx int

	done bool
	err  error
}

func (it *worklogIterator) Next() bool {
	if it.maxTotal > 0 && it.worklogIdx >= it.maxTotal {
		return false
	}

	if it.worklogIdx < len(it.worklogs) {
		return true
	}

	if it.done {
		return false
	}

	for {
		if it.issueIdx >= len(it.issues) {
			if it.issueStartAt >= it.issueTotal && it.issueTotal > 0 {
				it.done = true
				return false
			}
			if err := it.fetchIssues(); err != nil {
				it.err = err
				return false
			}
			if len(it.issues) == 0 {
				it.done = true
				return false
			}
		}

		issue := it.issues[it.issueIdx]
		it.issueIdx++

		worklogs, err := it.fetchWorklogsForIssue(issue.Key)
		if err != nil {
			it.err = err
			return false
		}

		if len(worklogs) > 0 {
			it.worklogs = worklogs
			it.worklogIdx = 0
			return true
		}
	}
}

func (it *worklogIterator) fetchIssues() error {
	query := url.Values{}
	query.Set("jql", it.jql)
	query.Set("startAt", strconv.Itoa(it.issueStartAt))
	query.Set("maxResults", strconv.Itoa(it.fetchSize))
	query.Set("fields", "key")

	resp, err := it.jira.Client.Get(it.ctx, "/rest/api/3/search/jql", query)
	if err != nil {
		return err
	}

	var result SearchResult
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.issueTotal = result.Total
	it.issues = result.Issues
	it.issueIdx = 0
	it.issueStartAt += len(result.Issues)
	return nil
}

func (it *worklogIterator) fetchWorklogsForIssue(issueKey string) ([]endpoint.Record, error) {
	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog", issueKey)
	resp, err := it.jira.Client.Get(it.ctx, path, nil)
	if err != nil {
		return nil, err
	}

	var result WorklogsResponse
	if err := resp.JSON(&result); err != nil {
		return nil, err
	}

	records := make([]endpoint.Record, 0, len(result.Worklogs))
	for _, w := range result.Worklogs {
		author := ""
		if w.Author != nil {
			author = w.Author.DisplayName
		}
		records = append(records, endpoint.Record{
			"worklogId":        w.ID,
			"issueKey":         issueKey,
			"author":           author,
			"timeSpentSeconds": w.TimeSpentSeconds,
			"startedAt":        w.Started,
			"updatedAt":        w.Started, // Worklogs don't have separate updated field
			"_raw":             w,
		})
	}
	return records, nil
}

func (it *worklogIterator) Value() endpoint.Record {
	if it.worklogIdx < len(it.worklogs) {
		rec := it.worklogs[it.worklogIdx]
		it.worklogIdx++
		return rec
	}
	return nil
}

func (it *worklogIterator) Err() error  { return it.err }
func (it *worklogIterator) Close() error { return nil }

// =============================================================================
// HELPERS
// =============================================================================

// buildJQL constructs JQL from request parameters.
func (j *Jira) buildJQL(req *endpoint.ReadRequest) string {
	jql := j.config.JQL
	if jql == "" {
		jql = "ORDER BY updated DESC"
	}

	// Add project filter if configured
	if len(j.config.Projects) > 0 {
		projectFilter := "project IN (" + joinStrings(j.config.Projects, ",") + ")"
		jql = projectFilter + " AND " + jql
	}

	// Add incremental filter if slice provided
	if req.Slice != nil && req.Slice.Lower != "" {
		jql = fmt.Sprintf("updated >= '%s' AND %s", req.Slice.Lower, jql)
	}

	return jql
}
