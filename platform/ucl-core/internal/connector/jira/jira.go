package jira

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/nucleus/ucl-core/internal/connector/http"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// JIRA CONNECTOR
// Implements endpoint.SourceEndpoint and endpoint.SliceCapable
// =============================================================================

// Ensure interface compliance
var (
	_ endpoint.SourceEndpoint    = (*Jira)(nil)
	_ endpoint.SliceCapable      = (*Jira)(nil)
	_ endpoint.AdaptiveIngestion = (*Jira)(nil)
)

// Jira is the Jira Cloud connector.
type Jira struct {
	*http.Base
	config *Config
}

// New creates a new Jira connector with the given configuration.
func New(config *Config) (*Jira, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}

	httpConfig := http.DefaultClientConfig()
	httpConfig.BaseURL = config.BaseURL
	httpConfig.Auth = http.AtlassianAuth{
		Email:    config.Email,
		APIToken: config.APIToken,
	}
	httpConfig.Headers["Accept"] = "application/json"
	httpConfig.Headers["Content-Type"] = "application/json"

	j := &Jira{
		Base:   http.NewBase("http.jira", "Jira", "Atlassian", httpConfig),
		config: config,
	}

	return j, nil
}

// =============================================================================
// ENDPOINT INTERFACE
// =============================================================================

// ValidateConfig tests the connection to Jira.
func (j *Jira) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	resp, err := j.Client.Get(ctx, "/rest/api/3/serverInfo", nil)
	if err != nil {
		if httpErr, ok := err.(*http.HTTPError); ok {
			return &endpoint.ValidationResult{
				Valid:   false,
				Message: fmt.Sprintf("Connection failed: HTTP %d", httpErr.StatusCode),
			}, nil
		}
		return nil, err
	}

	var info struct {
		Version string `json:"version"`
	}
	if err := resp.JSON(&info); err == nil {
		j.Version = info.Version
	}

	return &endpoint.ValidationResult{
		Valid:           true,
		Message:         "Connection successful",
		DetectedVersion: j.Version,
	}, nil
}

// GetCapabilities returns Jira source capabilities.
func (j *Jira) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: true, // JQL `updated >= watermark` filtering enabled
		SupportsCountProbe:  true,
		SupportsPreview:     true,
		SupportsMetadata:    true,
		SupportsWrite:       false,
		DefaultFetchSize:    j.config.FetchSize,
	}
}

// GetDescriptor returns the Jira endpoint descriptor.
func (j *Jira) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          "http.jira",
		Family:      "http",
		Title:       "Jira Cloud",
		Vendor:      "Atlassian",
		Description: "Jira Cloud REST API connector for projects, issues, and work tracking",
		Categories:  []string{"work", "project-management"},
		Protocols:   []string{"https"},
		DocsURL:     "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
		Fields: []*endpoint.FieldDescriptor{
			{Key: "baseUrl", Label: "Jira URL", ValueType: "string", Required: true, Semantic: "HOST", Placeholder: "https://yoursite.atlassian.net"},
			{Key: "email", Label: "Email", ValueType: "string", Required: true, Semantic: "GENERIC"},
			{Key: "apiToken", Label: "API Token", ValueType: "password", Required: true, Sensitive: true, Semantic: "PASSWORD"},
			{Key: "projects", Label: "Project Keys", ValueType: "string", Required: false, Description: "Comma-separated project keys to filter"},
		},
	}
}

// ProbeIngestion estimates slice keys and counts for deterministic planning.
func (j *Jira) ProbeIngestion(ctx context.Context, req *endpoint.ProbeRequest) (*endpoint.ProbeResult, error) {
	_ = ctx
	_ = req

	projects := append([]string{}, j.config.Projects...)
	if len(projects) == 0 {
		projects = []string{"default"}
	}
	sort.Strings(projects)

	estPerProject := int64(j.config.FetchSize)
	if estPerProject <= 0 {
		estPerProject = DefaultFetchSize
	}
	estimatedCount := estPerProject * int64(len(projects))
	estimatedBytes := estimatedCount * 512 // rough envelope estimate

	sliceKeys := make([]string, len(projects))
	for i, key := range projects {
		sliceKeys[i] = fmt.Sprintf("project-%s", strings.ToLower(key))
	}

	return &endpoint.ProbeResult{
		EstimatedCount: estimatedCount,
		EstimatedBytes: estimatedBytes,
		SliceKeys:      sliceKeys,
		Details: map[string]any{
			"projects":  projects,
			"pageLimit": estPerProject,
		},
	}, nil
}

// PlanIngestion produces deterministic slices using project keys and bounded pages.
func (j *Jira) PlanIngestion(ctx context.Context, req *endpoint.PlanIngestionRequest) (*endpoint.IngestionPlan, error) {
	_ = ctx
	if req == nil {
		req = &endpoint.PlanIngestionRequest{}
	}

	pageLimit := req.PageLimit
	if pageLimit <= 0 {
		pageLimit = j.config.FetchSize
		if pageLimit <= 0 {
			pageLimit = DefaultFetchSize
		}
	}

	projects := append([]string{}, j.config.Projects...)
	if len(projects) == 0 && req.Probe != nil && len(req.Probe.SliceKeys) > 0 {
		for _, key := range req.Probe.SliceKeys {
			projects = append(projects, strings.TrimPrefix(key, "project-"))
		}
	}
	if len(projects) == 0 {
		projects = []string{"default"}
	}
	sort.Strings(projects)

	// Datasets like statuses/priorities do not benefit from project slicing.
	if !shouldSliceJiraDataset(req.DatasetID) {
		return &endpoint.IngestionPlan{
			DatasetID: req.DatasetID,
			Strategy:  "full",
			Slices: []*endpoint.IngestionSlice{
				{
					SliceID:       "full",
					Sequence:      0,
					EstimatedRows: int64(pageLimit),
				},
			},
			Statistics: map[string]any{
				"pageLimit": pageLimit,
				"projects":  projects,
			},
		}, nil
	}

	estPerProject := int64(pageLimit)
	if req.Probe != nil && len(projects) > 0 && req.Probe.EstimatedCount > 0 {
		if per := req.Probe.EstimatedCount / int64(len(projects)); per > 0 {
			estPerProject = per
		}
	}

	slices := make([]*endpoint.IngestionSlice, 0, len(projects))
	for idx, key := range projects {
		slices = append(slices, &endpoint.IngestionSlice{
			SliceID:       fmt.Sprintf("project-%s-page-1", strings.ToLower(key)),
			Sequence:      idx,
			Params:        map[string]any{"projectKey": key, "pageLimit": pageLimit},
			EstimatedRows: estPerProject,
		})
	}

	return &endpoint.IngestionPlan{
		DatasetID: req.DatasetID,
		Strategy:  "adaptive",
		Slices:    slices,
		Statistics: map[string]any{
			"projects":       projects,
			"pageLimit":      pageLimit,
			"estimatedCount": estPerProject * int64(len(projects)),
		},
	}, nil
}

// =============================================================================
// SOURCE ENDPOINT - Catalog-Driven
// =============================================================================

// ListDatasets returns available Jira datasets from catalog.
func (j *Jira) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	datasets := make([]*endpoint.Dataset, 0, len(DatasetDefinitions))

	for id, def := range DatasetDefinitions {
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  id,
			Name:                def.Name,
			Kind:                "entity",
			SupportsIncremental: def.SupportsIncremental,
			CdmModelID:          def.CdmModelID,
			IngestionStrategy:   inferStrategy(def),
			IncrementalColumn:   def.IncrementalCursor,
			IncrementalLiteral:  "timestamp",
		})
	}

	return datasets, nil
}

// GetSchema returns schema from catalog definitions.
func (j *Jira) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	def, ok := DatasetDefinitions[datasetID]
	if !ok {
		return nil, fmt.Errorf("unknown dataset: %s", datasetID)
	}

	fields := make([]*endpoint.FieldDefinition, 0, len(def.StaticFields))
	for i, f := range def.StaticFields {
		fields = append(fields, &endpoint.FieldDefinition{
			Name:     f.Name,
			DataType: f.DataType,
			Nullable: f.Nullable,
			Comment:  f.Comment,
			Position: i + 1,
		})
	}

	return &endpoint.Schema{Fields: fields}, nil
}

// Read routes to the appropriate handler based on dataset.
func (j *Jira) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	def, ok := DatasetDefinitions[req.DatasetID]
	if !ok {
		return nil, fmt.Errorf("unknown dataset: %s", req.DatasetID)
	}

	switch def.Handler {
	case "projects":
		return j.handleProjects(ctx, req)
	case "users":
		return j.handleUsers(ctx, req)
	case "issues":
		return j.handleIssues(ctx, req)
	case "issue_types":
		return j.handleIssueTypes(ctx, req)
	case "statuses":
		return j.handleStatuses(ctx, req)
	case "priorities":
		return j.handlePriorities(ctx, req)
	case "comments":
		return j.handleComments(ctx, req)
	case "worklogs":
		return j.handleWorklogs(ctx, req)
	case "api_surface":
		return j.handleAPISurface(ctx, req)
	default:
		return nil, fmt.Errorf("no handler for dataset: %s", req.DatasetID)
	}
}

// =============================================================================
// SLICE CAPABLE
// =============================================================================

// GetCheckpoint returns the current checkpoint for a dataset.
func (j *Jira) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	def, ok := DatasetDefinitions[datasetID]
	if !ok || !def.SupportsIncremental {
		return nil, nil
	}

	return &endpoint.Checkpoint{
		Watermark: "",
		Metadata: map[string]any{
			"incrementalColumn": def.IncrementalCursor,
			"incrementalType":   "timestamp",
		},
	}, nil
}

// PlanSlices creates an ingestion plan.
func (j *Jira) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	plan, err := j.PlanIngestion(ctx, &endpoint.PlanIngestionRequest{
		DatasetID: req.DatasetID,
		Filters:   map[string]any{},
		PageLimit: int(req.TargetSliceSize),
	})
	if err != nil {
		return nil, err
	}
	if plan.Strategy == "" {
		plan.Strategy = req.Strategy
	}
	return plan, nil
}

// ReadSlice reads a specific slice of data.
func (j *Jira) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return j.Read(ctx, &endpoint.ReadRequest{
		DatasetID: req.DatasetID,
		Limit:     0,
		Slice:     req.Slice,
	})
}

// CountBetween counts records in a range.
func (j *Jira) CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error) {
	def, ok := DatasetDefinitions[datasetID]
	if !ok {
		return 0, fmt.Errorf("unknown dataset: %s", datasetID)
	}

	// Only issues support JQL count
	if def.Handler != "issues" {
		return 0, fmt.Errorf("count not supported for dataset: %s", datasetID)
	}

	jql := "ORDER BY updated DESC"
	if lower != "" {
		jql = fmt.Sprintf("updated >= '%s'", lower)
	}
	if upper != "" {
		jql += fmt.Sprintf(" AND updated <= '%s'", upper)
	}

	resp, err := j.Client.Get(ctx, "/rest/api/3/search/jql", map[string][]string{
		"jql":        {jql},
		"maxResults": {"0"},
	})
	if err != nil {
		return 0, err
	}

	var result SearchResult
	if err := resp.JSON(&result); err != nil {
		return 0, err
	}

	return int64(result.Total), nil
}

// =============================================================================
// ISSUE ITERATOR
// =============================================================================

type issueIterator struct {
	jira       *Jira
	ctx        context.Context
	jql        string
	fetchSize  int
	maxResults int

	startAt int
	total   int
	fetched int
	current []*Issue
	index   int
	done    bool
	err     error
}

func (it *issueIterator) Next() bool {
	if it.maxResults > 0 && it.fetched >= it.maxResults {
		return false
	}

	if it.index < len(it.current) {
		return true
	}

	if it.done {
		return false
	}

	if err := it.fetchPage(); err != nil {
		it.err = err
		return false
	}

	return it.index < len(it.current)
}

func (it *issueIterator) fetchPage() error {
	resp, err := it.jira.Client.Get(it.ctx, "/rest/api/3/search/jql", map[string][]string{
		"jql":        {it.jql},
		"startAt":    {fmt.Sprintf("%d", it.startAt)},
		"maxResults": {fmt.Sprintf("%d", it.fetchSize)},
		"expand":     {"names"},
	})
	if err != nil {
		return err
	}

	var result SearchResult
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.total = result.Total
	it.current = result.Issues
	it.index = 0
	it.startAt += len(result.Issues)

	if it.startAt >= it.total || len(result.Issues) == 0 {
		it.done = true
	}

	return nil
}

func (it *issueIterator) Value() endpoint.Record {
	if it.index < len(it.current) {
		issue := it.current[it.index]
		it.index++
		it.fetched++

		// Use static fields from catalog
		fields := issue.Fields
		status := ""
		if fields.Status != nil {
			status = fields.Status.Name
		}
		issueType := ""
		if fields.IssueType != nil {
			issueType = fields.IssueType.Name
		}
		assignee := ""
		if fields.Assignee != nil {
			assignee = fields.Assignee.DisplayName
		}
		reporter := ""
		if fields.Reporter != nil {
			reporter = fields.Reporter.DisplayName
		}
		priority := ""
		if fields.Priority != nil {
			priority = fields.Priority.Name
		}
		projectKey := ""
		if fields.Project != nil {
			projectKey = fields.Project.Key
		}

		return endpoint.Record{
			"issueKey":   issue.Key,
			"summary":    fields.Summary,
			"status":     status,
			"projectKey": projectKey,
			"issueType":  issueType,
			"assignee":   assignee,
			"reporter":   reporter,
			"priority":   priority,
			"updatedAt":  fields.Updated,
			"createdAt":  fields.Created,
			"_raw":       issue, // Keep raw for CDM mapper
		}
	}
	return nil
}

func (it *issueIterator) Err() error   { return it.err }
func (it *issueIterator) Close() error { return nil }

// =============================================================================
// SLICE ITERATOR
// =============================================================================

type sliceIterator struct {
	records []endpoint.Record
	index   int
	limit   int
}

func (it *sliceIterator) Next() bool {
	if it.limit > 0 && it.index >= it.limit {
		return false
	}
	return it.index < len(it.records)
}

func (it *sliceIterator) Value() endpoint.Record {
	if it.index < len(it.records) {
		rec := it.records[it.index]
		it.index++
		return rec
	}
	return nil
}

func (it *sliceIterator) Err() error   { return nil }
func (it *sliceIterator) Close() error { return nil }

// =============================================================================
// HELPERS
// =============================================================================

func shouldSliceJiraDataset(datasetID string) bool {
	switch datasetID {
	case "jira.issues", "jira.comments", "jira.worklogs":
		return true
	default:
		return false
	}
}

func inferStrategy(def DatasetDefinition) string {
	if def.SupportsIncremental {
		return "scd1"
	}
	return "full"
}

func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}

func bodyToString(body any) string {
	if body == nil {
		return ""
	}
	if s, ok := body.(string); ok {
		return s
	}
	return "[ADF content]"
}
