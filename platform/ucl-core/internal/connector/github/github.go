package github

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	nethttp "net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nucleus/ucl-core/internal/connector/http"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure interface compliance.
var (
	_ endpoint.SourceEndpoint    = (*GitHub)(nil)
	_ endpoint.AdaptiveIngestion = (*GitHub)(nil)
	_ endpoint.SliceCapable      = (*GitHub)(nil)
)

// GitHub implements a semantic GitHub code source.
type GitHub struct {
	*http.Base
	config *Config
	repos  map[string]Repo
	stub   *StubServer
}

// New creates a GitHub connector from raw config.
func New(config map[string]any) (*GitHub, error) {
	cfg, err := ParseConfig(config)
	if err != nil {
		return nil, err
	}

	clientCfg := http.DefaultClientConfig()
	clientCfg.BaseURL = cfg.BaseURL
	clientCfg.Auth = http.BearerToken{Token: cfg.Token}
	clientCfg.Headers["Accept"] = "application/vnd.github+json"
	clientCfg.Headers["X-GitHub-Api-Version"] = "2022-11-28"

	var transport nethttp.RoundTripper
	if t, ok := config["transport"].(nethttp.RoundTripper); ok {
		transport = t
	}
	var stub *StubServer
	if transport == nil && strings.Contains(strings.ToLower(cfg.BaseURL), "stub.github") {
		stub = NewStubServer()
		transport = stub.Transport()
		cfg.BaseURL = stub.URL()
	}
	if transport != nil {
		clientCfg.Transport = transport
	}

	return &GitHub{
		Base:   http.NewBase("http.github", "GitHub", "GitHub", clientCfg),
		config: cfg,
		repos:  map[string]Repo{},
		stub:   stub,
	}, nil
}

// ValidateConfig verifies connectivity. If no token is provided, we only probe a public endpoint.
func (g *GitHub) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	if strings.TrimSpace(g.config.Token) == "" {
		return &endpoint.ValidationResult{
			Valid:           true,
			Message:         "Public access (no token) - GitHub may rate limit (60 req/hr)",
			DetectedVersion: "rest",
		}, nil
	}

	user, err := g.fetchCurrentUser(ctx)
	if err != nil {
		return nil, err
	}
	msg := "Connection successful"
	if user != "" {
		msg = fmt.Sprintf("Authenticated as %s", user)
	}
	return &endpoint.ValidationResult{
		Valid:           true,
		Message:         msg,
		DetectedVersion: "rest",
	}, nil
}

// GetCapabilities returns GitHub capabilities.
func (g *GitHub) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: false,
		SupportsCountProbe:  true,
		SupportsPreview:     true,
		SupportsMetadata:    true,
	}
}

// ConnectionURL exposes the base URL for config builds.
func (g *GitHub) ConnectionURL() string {
	if strings.TrimSpace(g.config.BaseURL) != "" {
		return g.config.BaseURL
	}
	return defaultBaseURL
}

// GetDescriptor describes the GitHub endpoint template.
func (g *GitHub) GetDescriptor() *endpoint.Descriptor {
	defaultBase := g.config.BaseURL
	if defaultBase == "" {
		defaultBase = defaultBaseURL
	}
	return &endpoint.Descriptor{
		ID:          "http.github",
		Family:      "HTTP",
		Title:       "GitHub",
		Vendor:      "GitHub",
		Description: "GitHub REST API for code metadata, preview, and ingestion.",
		Categories:  []string{"code", "source-control"},
		Protocols:   []string{"https"},
		DocsURL:     "https://docs.github.com/en/rest",
		DefaultLabels: []string{
			"github",
			"code",
		},
		Capabilities: []*endpoint.CapabilityDescriptor{
			{Key: "metadata", Label: "Metadata collection", Description: "List repositories as catalog datasets."},
			{Key: "preview", Label: "Preview", Description: "Preview repository files with safety checks."},
			{Key: "ingestion", Label: "Ingestion", Description: "Ingest code files and chunks via staging."},
		},
		Connection: &endpoint.ConnectionConfig{
			URLTemplate: "{{base_url}}",
			DefaultVerb: "GET",
		},
		Auth: &endpoint.AuthDescriptor{
			Modes: []endpoint.AuthModeDescriptor{
				{
					Mode:           "service_pat",
					Label:          "Service PAT",
					RequiredFields: []string{"token"},
					Scopes:         []string{"repo"},
					Interactive:    false,
				},
				{
					Mode:        "delegated_auth_code_pkce",
					Label:       "Delegated (OAuth PKCE)",
					Scopes:      []string{"repo", "read:user"},
					Interactive: true,
				},
				{
					Mode:        "anonymous",
					Label:       "Public (no token)",
					Scopes:      []string{},
					Interactive: false,
				},
			},
			ProfileBinding: &endpoint.ProfileBindingDescriptor{
				Supported:      true,
				PrincipalKinds: []string{"user"},
				Notes:          "Delegated mode binds to Workspace user via OAuth PKCE.",
			},
		},
		Fields: []*endpoint.FieldDescriptor{
			{Key: "base_url", Label: "Base URL", ValueType: "string", Required: false, DefaultValue: defaultBase, Placeholder: defaultBase},
			{Key: "token", Label: "Token", ValueType: "password", Required: false, Sensitive: true, Description: "GitHub PAT/app token (optional for public repos; recommended to avoid rate limits)."},
			{Key: "owners", Label: "Owner allowlist", ValueType: "string", Required: false, Description: "Comma-separated owner/org filters."},
			{Key: "repos", Label: "Repo allowlist", ValueType: "string", Required: false, Description: "Comma-separated repo names (owner/repo)."},
			{Key: "branch", Label: "Branch", ValueType: "string", Required: false, Description: "Branch/ref to use; defaults to repo default branch."},
			{Key: "path_prefixes", Label: "Path prefixes", ValueType: "string", Required: false, Description: "Comma-separated path prefixes for slicing."},
			{Key: "file_extensions_include", Label: "File extensions include", ValueType: "string", Required: false, Description: "Comma-separated extensions to include (e.g., .go,.ts,.md)."},
			{Key: "max_file_bytes", Label: "Max file bytes", ValueType: "integer", DefaultValue: fmt.Sprint(g.config.MaxFileBytes)},
			{Key: "chunk_bytes", Label: "Chunk bytes", ValueType: "integer", DefaultValue: fmt.Sprint(g.config.ChunkBytes)},
			{Key: "overlap_bytes", Label: "Overlap bytes", ValueType: "integer", DefaultValue: fmt.Sprint(g.config.OverlapBytes)},
			{Key: "tenant_id", Label: "Tenant ID", ValueType: "string", Required: false, Description: "Tenant identifier used for canonical dataset keys."},
		},
		SampleConfig: map[string]any{
			"templateId": "http.github",
			"parameters": map[string]any{
				"base_url": defaultBase,
				"token":    "<token>",
				"owners":   "octo-org",
				"repos":    "octo-org/alpha,octo-org/beta",
			},
		},
		Extras: map[string]any{
			"ingestionUnits": []map[string]any{
				{
					"unitId":              "github.repo",
					"datasetId":           "github.repo",
					"displayName":         "GitHub Repository",
					"supportsIncremental": false,
					"cdmModelId":          "",
				},
			},
		},
	}
}

// ListDatasets lists all datasets: repos + entity datasets (issues, PRs, commits, etc.) per repo.
func (g *GitHub) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	repos, err := g.fetchRepos(ctx)
	if err != nil {
		return nil, err
	}

	tenant := g.config.TenantID
	datasets := make([]*endpoint.Dataset, 0, len(repos)*9) // 9 dataset types per repo

	for _, repo := range repos {
		projectKey := repo.ProjectKey()

		// 1. Repository dataset (catalog)
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  buildDatasetID(tenant, projectKey),
			Name:                projectKey,
			Description:         "GitHub repository",
			Kind:                "dataset",
			SupportsIncremental: true,
			IngestionStrategy:   "full",
			Metadata: map[string]string{
				"datasetType":   "github.repos",
				"projectKey":    projectKey,
				"defaultBranch": repo.DefaultBranch,
				"htmlUrl":       repo.HTMLURL,
				"apiUrl":        repo.APIURL,
				"visibility":    repo.Visibility,
				"updatedAt":     repo.UpdatedAt.Format(time.RFC3339),
			},
		})

		// 2. Issues dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.issues:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/issues", projectKey),
			Description:         "GitHub issues",
			Kind:                "dataset",
			SupportsIncremental: true,
			IngestionStrategy:   "incremental",
			Metadata: map[string]string{
				"datasetType": "github.issues",
				"projectKey":  projectKey,
			},
		})

		// 3. Pull requests dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.pull_requests:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/pulls", projectKey),
			Description:         "GitHub pull requests",
			Kind:                "dataset",
			SupportsIncremental: true,
			IngestionStrategy:   "incremental",
			Metadata: map[string]string{
				"datasetType": "github.pull_requests",
				"projectKey":  projectKey,
			},
		})

		// 4. Commits dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.commits:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/commits", projectKey),
			Description:         "GitHub commits",
			Kind:                "dataset",
			SupportsIncremental: true,
			IngestionStrategy:   "incremental",
			Metadata: map[string]string{
				"datasetType": "github.commits",
				"projectKey":  projectKey,
			},
		})

		// 5. Comments dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.comments:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/comments", projectKey),
			Description:         "GitHub comments on issues and PRs",
			Kind:                "dataset",
			SupportsIncremental: true,
			IngestionStrategy:   "incremental",
			Metadata: map[string]string{
				"datasetType": "github.comments",
				"projectKey":  projectKey,
			},
		})

		// 6. Reviews dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.reviews:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/reviews", projectKey),
			Description:         "GitHub PR reviews",
			Kind:                "dataset",
			SupportsIncremental: false,
			IngestionStrategy:   "full",
			Metadata: map[string]string{
				"datasetType": "github.reviews",
				"projectKey":  projectKey,
			},
		})

		// 7. Releases dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.releases:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/releases", projectKey),
			Description:         "GitHub releases",
			Kind:                "dataset",
			SupportsIncremental: false,
			IngestionStrategy:   "full",
			Metadata: map[string]string{
				"datasetType": "github.releases",
				"projectKey":  projectKey,
			},
		})

		// 8. Code files dataset
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.files:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/files", projectKey),
			Description:         "GitHub code files",
			Kind:                "dataset",
			SupportsIncremental: false,
			IngestionStrategy:   "full",
			Metadata: map[string]string{
				"datasetType": "github.files",
				"projectKey":  projectKey,
			},
		})

		// 9. Code chunks dataset (for vector indexing)
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  fmt.Sprintf("github.file_chunks:%s:%s", tenant, projectKey),
			Name:                fmt.Sprintf("%s/chunks", projectKey),
			Description:         "GitHub code chunks for vector indexing",
			Kind:                "dataset",
			SupportsIncremental: false,
			IngestionStrategy:   "full",
			Metadata: map[string]string{
				"datasetType": "github.file_chunks",
				"projectKey":  projectKey,
			},
		})
	}

	// Add global api_surface dataset (not per-repo)
	datasets = append(datasets, &endpoint.Dataset{
		ID:                  "github.api_surface",
		Name:                "API Surface",
		Description:         "Inventory of GitHub REST APIs used by Nucleus for agentic discovery",
		Kind:                "dataset",
		SupportsIncremental: false,
		IngestionStrategy:   "full",
		Metadata: map[string]string{
			"datasetType": "github.api_surface",
		},
	})

	return datasets, nil
}

// GetSchema returns a simple schema for repo datasets.
func (g *GitHub) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	_ = ctx
	fields := []*endpoint.FieldDefinition{
		{Name: "projectKey", DataType: "STRING", Nullable: false},
		{Name: "defaultBranch", DataType: "STRING", Nullable: true},
		{Name: "htmlUrl", DataType: "STRING", Nullable: true},
		{Name: "apiUrl", DataType: "STRING", Nullable: true},
		{Name: "visibility", DataType: "STRING", Nullable: true},
		{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
	}
	for i, f := range fields {
		f.Position = i + 1
	}
	return &endpoint.Schema{Fields: fields}, nil
}

// Read routes preview/read based on filter.
func (g *GitHub) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}

	// Handle api_surface dataset
	if req.DatasetID == "github.api_surface" {
		return g.handleAPISurface(ctx, req)
	}

	// Handle API-backed datasets directly
	if datasetType := datasetTypePrefix(req.DatasetID); datasetType != "" {
		if _, ok := githubDatasets[datasetType]; ok && datasetType != "github.files" && datasetType != "github.file_chunks" {
			params := map[string]any{}
			if req.Limit > 0 {
				params["limit"] = int(req.Limit)
			}
			return g.readAPIDataset(ctx, datasetType, &endpoint.SliceReadRequest{
				DatasetID:  req.DatasetID,
				Filter:     req.Filter,
				Checkpoint: req.Checkpoint, // CHECKPOINT FIX: Pass checkpoint for incremental ingestion
				Slice: &endpoint.IngestionSlice{
					SliceID: "full",
					Params:  params,
				},
			})
		}
	}

	if req.Filter != nil {
		if path, ok := req.Filter["path"].(string); ok && strings.TrimSpace(path) != "" {
			return g.previewFile(ctx, req, path)
		}
	}

	return g.ReadSlice(ctx, &endpoint.SliceReadRequest{
		DatasetID: req.DatasetID,
		Slice: &endpoint.IngestionSlice{
			SliceID: "full",
			Params:  map[string]any{},
		},
		Filter: req.Filter,
	})
}

// ProbeIngestion inspects repos to estimate size.
func (g *GitHub) ProbeIngestion(ctx context.Context, req *endpoint.ProbeRequest) (*endpoint.ProbeResult, error) {
	repos, err := g.fetchRepos(ctx)
	if err != nil {
		return nil, err
	}

	var estimatedCount int64
	details := map[string]any{"repos": []string{}}
	var repoNames []string
	for _, repo := range repos {
		repoNames = append(repoNames, repo.ProjectKey())
		estimatedCount += int64(len(repo.Files))
	}
	sort.Strings(repoNames)
	details["repos"] = repoNames

	return &endpoint.ProbeResult{
		EstimatedCount: estimatedCount,
		EstimatedBytes: estimatedCount * 1024,
		SliceKeys:      repoNames,
		Details:        details,
	}, nil
}

// GetCheckpoint returns nil because GitHub currently does not persist watermarks.
func (g *GitHub) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	_ = ctx
	_ = datasetID
	return nil, nil
}

// PlanSlices proxies to PlanIngestion to satisfy SliceCapable for Temporal ingestion.
func (g *GitHub) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	pageLimit := int(req.TargetSliceSize)
	plan, err := g.PlanIngestion(ctx, &endpoint.PlanIngestionRequest{
		DatasetID: req.DatasetID,
		PageLimit: pageLimit,
		Filters:   nil,
	})
	if err != nil {
		return nil, err
	}
	if req.Strategy != "" {
		plan.Strategy = req.Strategy
	}
	return plan, nil
}

// PlanIngestion builds deterministic slices.
func (g *GitHub) PlanIngestion(ctx context.Context, req *endpoint.PlanIngestionRequest) (*endpoint.IngestionPlan, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}

	datasetType := datasetTypePrefix(req.DatasetID)
	if def, ok := githubDatasets[datasetType]; ok && datasetType != "github.files" && datasetType != "github.file_chunks" && datasetType != "github.api_surface" {
		repos, err := g.fetchRepos(ctx)
		if err != nil {
			return nil, err
		}
		_, targetProject := parseDatasetProject(req.DatasetID, g.config.TenantID)
		if targetProject != "" {
			filtered := make([]Repo, 0, 1)
			for _, r := range repos {
				if strings.EqualFold(r.ProjectKey(), targetProject) {
					filtered = append(filtered, r)
					break
				}
			}
			repos = filtered
		}

		if len(repos) == 0 {
			return nil, fmt.Errorf("no repositories available for dataset %s", req.DatasetID)
		}

		limit := req.PageLimit
		if limit <= 0 {
			limit = 100
		}

		slices := make([]*endpoint.IngestionSlice, 0, len(repos))
		seq := 0
		for _, repo := range repos {
			slices = append(slices, &endpoint.IngestionSlice{
				SliceID:  fmt.Sprintf("%s:%s", datasetType, repo.ProjectKey()),
				Sequence: seq,
				Params: map[string]any{
					"projectKey": repo.ProjectKey(),
					"limit":      int(limit),
				},
			})
			seq++
		}

		strategy := "full"
		if def.SupportsIncremental {
			strategy = "incremental"
		}

		stats := map[string]any{
			"repos": len(repos),
			"limit": limit,
		}

		return &endpoint.IngestionPlan{
			DatasetID:  req.DatasetID,
			Strategy:   strategy,
			Slices:     slices,
			Statistics: stats,
		}, nil
	}

	if datasetType == "github.api_surface" {
		limit := req.PageLimit
		if limit <= 0 {
			limit = 100
		}
		return &endpoint.IngestionPlan{
			DatasetID: req.DatasetID,
			Strategy:  "full",
			Slices: []*endpoint.IngestionSlice{
				{
					SliceID:  "full",
					Sequence: 0,
					Params: map[string]any{
						"limit": int(limit),
					},
				},
			},
			Statistics: map[string]any{
				"limit": limit,
			},
		}, nil
	}

	repos, err := g.fetchRepos(ctx)
	if err != nil {
		return nil, err
	}

	_, targetProject := parseDatasetProject(req.DatasetID, g.config.TenantID)
	if targetProject != "" {
		filtered := make([]Repo, 0, 1)
		for _, r := range repos {
			if strings.EqualFold(r.ProjectKey(), targetProject) {
				filtered = append(filtered, r)
				break
			}
		}
		repos = filtered
	}
	if len(repos) == 0 {
		return nil, fmt.Errorf("no repositories available for dataset %s", req.DatasetID)
	}

	pageLimit := req.PageLimit
	if pageLimit <= 0 {
		pageLimit = 100
	}

	var slices []*endpoint.IngestionSlice
	sequence := 0
	prefixes := g.config.PathPrefixes
	if len(prefixes) == 0 {
		prefixes = []string{""}
	}

	for _, repo := range repos {
		branch := g.config.Branch
		if branch == "" {
			branch = repo.DefaultBranch
		}
		for _, prefix := range prefixes {
			sliceID := fmt.Sprintf("github:%s:%s:%s", repo.ProjectKey(), branch, prefix)
			slices = append(slices, &endpoint.IngestionSlice{
				SliceID:  sliceID,
				Sequence: sequence,
				Params: map[string]any{
					"projectKey": repo.ProjectKey(),
					"branch":     branch,
					"pathPrefix": prefix,
				},
			})
			sequence++
		}
	}

	stats := map[string]any{
		"estimatedCount": len(slices) * pageLimit,
		"repos":          len(repos),
	}

	return &endpoint.IngestionPlan{
		DatasetID:  req.DatasetID,
		Strategy:   "full",
		Slices:     slices,
		Statistics: stats,
	}, nil
}

// ReadSlice ingests files for a slice.
func (g *GitHub) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}

	// Handle API-backed datasets directly
	if datasetType := datasetTypePrefix(req.DatasetID); datasetType != "" {
		if _, ok := githubDatasets[datasetType]; ok && datasetType != "github.files" && datasetType != "github.file_chunks" {
			if req.Slice == nil {
				req.Slice = &endpoint.IngestionSlice{SliceID: "full", Params: map[string]any{}}
			}
			if req.Slice.Params == nil {
				req.Slice.Params = map[string]any{}
			}
			return g.readAPIDataset(ctx, datasetType, req)
		}
	}

	tenant, projectKey := parseDatasetProject(req.DatasetID, g.config.TenantID)
	if req.Slice != nil {
		if key, ok := req.Slice.Params["projectKey"].(string); ok && key != "" {
			projectKey = key
		}
	}
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required for ingestion")
	}

	repo, err := g.fetchRepo(ctx, projectKey)
	if err != nil {
		return nil, err
	}
	branch := g.config.Branch
	if branch == "" {
		branch = repo.DefaultBranch
	}
	if req.Slice != nil {
		if b, ok := req.Slice.Params["branch"].(string); ok && b != "" {
			branch = b
		}
	}

	pathPrefix := ""
	if req.Slice != nil {
		if p, ok := req.Slice.Params["pathPrefix"].(string); ok {
			pathPrefix = p
		}
	}
	filterPrefix := strings.TrimSpace(pathPrefix)

	entries, err := g.fetchTree(ctx, repo, branch)
	if err != nil {
		return nil, err
	}

	records := []endpoint.Record{}
	for _, entry := range entries {
		if entry.Type != "blob" {
			continue
		}
		if filterPrefix != "" && !strings.HasPrefix(entry.Path, filterPrefix) {
			continue
		}
		if len(g.config.FileExtensions) > 0 && !matchesExtension(entry.Path, g.config.FileExtensions) {
			continue
		}
		if entry.Size > int64(g.config.MaxFileBytes) {
			continue
		}

		content, err := g.fetchContent(ctx, repo, entry.Path, branch)
		if err != nil {
			if isRetryableError(err) {
				return nil, err
			}
			continue
		}

		if content.Size > int64(g.config.MaxFileBytes) {
			continue
		}
		if isLikelyBinary(content.Data) {
			continue
		}

		fileRecord := endpoint.Record{
			"_entity":     "code.file",
			"_tenantId":   tenant,
			"_projectKey": projectKey,
			"_sourceUrl":  content.HTMLURL,
			"_externalId": fmt.Sprintf("%s:%s", content.SHA, entry.Path),
			"repo":        projectKey,
			"path":        entry.Path,
			"sha":         content.SHA,
			"size":        content.Size,
			"url":         content.HTMLURL,
			"language":    detectLanguage(entry.Path),
		}
		if len(content.Data) < g.config.MaxFileBytes {
			fileRecord["contentText"] = content.Text()
		}
		records = append(records, fileRecord)

		chunks := chunkText(content.Text(), g.config.ChunkBytes, g.config.OverlapBytes)
		for idx, chunk := range chunks {
			records = append(records, endpoint.Record{
				"_entity":     "code.file_chunk",
				"_tenantId":   tenant,
				"_projectKey": projectKey,
				"_sourceUrl":  content.HTMLURL,
				"_externalId": fmt.Sprintf("%s:%s#%d", content.SHA, entry.Path, idx),
				"repo":        projectKey,
				"path":        entry.Path,
				"sha":         content.SHA,
				"chunkIndex":  idx,
				"text":        chunk,
			})
		}
	}

	return &recordIterator{records: records}, nil
}

// CountBetween provides best-effort count for probes.
func (g *GitHub) CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error) {
	_ = ctx
	_ = lower
	_ = upper
	repos, err := g.fetchRepos(ctx)
	if err != nil {
		return 0, err
	}
	var count int64
	for _, repo := range repos {
		count += int64(len(repo.Files))
	}
	return count, nil
}

func (g *GitHub) previewFile(ctx context.Context, req *endpoint.ReadRequest, path string) (endpoint.Iterator[endpoint.Record], error) {
	tenant, projectKey := parseDatasetProject(req.DatasetID, g.config.TenantID)
	if projectKey == "" {
		return nil, fmt.Errorf("project key required for preview")
	}
	repo, err := g.fetchRepo(ctx, projectKey)
	if err != nil {
		return nil, err
	}
	ref := g.config.Branch
	if ref == "" {
		ref = repo.DefaultBranch
	}
	if req.Filter != nil {
		if override, ok := req.Filter["ref"].(string); ok && override != "" {
			ref = override
		}
	}

	content, err := g.fetchContent(ctx, repo, path, ref)
	if err != nil {
		return nil, err
	}
	if content.Size > int64(g.config.MaxFileBytes) {
		return nil, &githubError{code: "E_PREVIEW_UNSUPPORTED", retryable: false, message: "file too large for preview"}
	}
	if isLikelyBinary(content.Data) {
		return nil, &githubError{code: "E_PREVIEW_UNSUPPORTED", retryable: false, message: "binary file not previewable"}
	}

	record := endpoint.Record{
		"path":             path,
		"url":              content.HTMLURL,
		"contentText":      content.Text(),
		"truncated":        false,
		"detectedLanguage": detectLanguage(path),
		"_tenantId":        tenant,
		"_projectKey":      projectKey,
	}

	return &recordIterator{records: []endpoint.Record{record}}, nil
}

func (g *GitHub) fetchCurrentUser(ctx context.Context) (string, error) {
	resp, err := g.Client.Get(ctx, "/user", nil)
	if err != nil {
		return "", mapHTTPError(err)
	}
	var payload struct {
		Login string `json:"login"`
	}
	if err := resp.JSON(&payload); err != nil {
		return "", mapHTTPError(err)
	}
	return payload.Login, nil
}

func (g *GitHub) fetchRepos(ctx context.Context) ([]Repo, error) {
	if len(g.repos) > 0 {
		repos := make([]Repo, 0, len(g.repos))
		for _, repo := range g.repos {
			repos = append(repos, repo)
		}
		sort.Slice(repos, func(i, j int) bool {
			return repos[i].ProjectKey() < repos[j].ProjectKey()
		})
		return repos, nil
	}

	// If explicit repos are configured, fetch them directly (works for public repos without auth)
	if len(g.config.Repos) > 0 {
		repos := make([]Repo, 0, len(g.config.Repos))
		for _, repoKey := range g.config.Repos {
			repo, err := g.fetchRepo(ctx, repoKey)
			if err != nil {
				// Skip repos that fail to fetch (might be private or non-existent)
				continue
			}
			repos = append(repos, repo)
		}
		sort.Slice(repos, func(i, j int) bool {
			return repos[i].ProjectKey() < repos[j].ProjectKey()
		})
		return repos, nil
	}

	// Otherwise list user's repos (requires auth)
	resp, err := g.Client.Get(ctx, "/user/repos", nil)
	if err != nil {
		return nil, mapHTTPError(err)
	}
	var payload []repoResponse
	if err := resp.JSON(&payload); err != nil {
		return nil, err
	}

	repoAllow := toSet(g.config.Repos)
	ownerAllow := toSet(g.config.Owners)
	repos := make([]Repo, 0, len(payload))
	for _, item := range payload {
		if len(ownerAllow) > 0 && !ownerAllow[strings.ToLower(item.Owner.Login)] {
			continue
		}
		projectKey := strings.ToLower(item.FullName)
		if len(repoAllow) > 0 && !repoAllow[projectKey] {
			continue
		}
		repo := Repo{
			Owner:         item.Owner.Login,
			Name:          item.Name,
			DefaultBranch: item.DefaultBranch,
			HTMLURL:       item.HTMLURL,
			APIURL:        item.URL,
			Visibility:    item.Visibility,
		}
		if item.UpdatedAt != "" {
			if ts, err := time.Parse(time.RFC3339, item.UpdatedAt); err == nil {
				repo.UpdatedAt = ts
			}
		}
		repo.Files = item.Files
		g.repos[repo.ProjectKey()] = repo
		repos = append(repos, repo)
	}
	sort.Slice(repos, func(i, j int) bool {
		return repos[i].ProjectKey() < repos[j].ProjectKey()
	})
	return repos, nil
}

func (g *GitHub) fetchRepo(ctx context.Context, projectKey string) (Repo, error) {
	if repo, ok := g.repos[strings.ToLower(projectKey)]; ok {
		return repo, nil
	}
	resp, err := g.Client.Get(ctx, fmt.Sprintf("/repos/%s", projectKey), nil)
	if err != nil {
		return Repo{}, mapHTTPError(err)
	}
	var payload repoResponse
	if err := resp.JSON(&payload); err != nil {
		return Repo{}, err
	}
	repo := Repo{
		Owner:         payload.Owner.Login,
		Name:          payload.Name,
		DefaultBranch: payload.DefaultBranch,
		HTMLURL:       payload.HTMLURL,
		APIURL:        payload.URL,
		Visibility:    payload.Visibility,
		Files:         payload.Files,
	}
	if payload.UpdatedAt != "" {
		if ts, err := time.Parse(time.RFC3339, payload.UpdatedAt); err == nil {
			repo.UpdatedAt = ts
		}
	}
	g.repos[repo.ProjectKey()] = repo
	return repo, nil
}

func (g *GitHub) fetchTree(ctx context.Context, repo Repo, branch string) ([]treeEntry, error) {
	path := fmt.Sprintf("/repos/%s/git/trees/%s", repo.ProjectKey(), branch)
	query := url.Values{"recursive": {"1"}}
	resp, err := g.Client.Get(ctx, path, query)
	if err != nil {
		return nil, mapHTTPError(err)
	}
	var payload treeResponse
	if err := resp.JSON(&payload); err != nil {
		return nil, err
	}
	return payload.Tree, nil
}

func (g *GitHub) readAPIDataset(ctx context.Context, datasetType string, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	def, ok := githubDatasets[datasetType]
	if !ok {
		return nil, fmt.Errorf("unsupported dataset: %s", datasetType)
	}
	_, projectKey := parseDatasetProject(req.DatasetID, g.config.TenantID)
	if projectKey == "" {
		if req.Slice != nil {
			if key, ok := req.Slice.Params["projectKey"].(string); ok && key != "" {
				projectKey = key
			}
		}
	}
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required for dataset %s", datasetType)
	}
	ownerRepo := strings.SplitN(projectKey, "/", 2)
	if len(ownerRepo) != 2 {
		return nil, fmt.Errorf("invalid project key: %s", projectKey)
	}
	owner, repoName := ownerRepo[0], ownerRepo[1]
	path := strings.ReplaceAll(strings.ReplaceAll(def.APIPath, "{owner}", owner), "{repo}", repoName)

	query := url.Values{}
	limit := 50
	if req != nil && req.Slice != nil {
		if l, ok := req.Slice.Params["limit"].(int); ok && l > 0 {
			limit = l
		}
	}
	query.Set("per_page", fmt.Sprintf("%d", limit))

	// CHECKPOINT FIX: Use checkpoint for incremental reads
	// Extract watermark from checkpoint and add 'since=' to API query
	var sinceWatermark string
	if req.Checkpoint != nil && def.SupportsIncremental {
		// DEBUG: Log checkpoint received
		log.Printf("[github-checkpoint] received checkpoint: %+v", req.Checkpoint)
		
		// Try multiple keys for watermark (cursor, watermark, since)
		if wm, ok := req.Checkpoint["watermark"].(string); ok && wm != "" {
			sinceWatermark = wm
			log.Printf("[github-checkpoint] found watermark key: %s", wm)
		} else if wm, ok := req.Checkpoint["cursor"].(string); ok && wm != "" {
			sinceWatermark = wm
			log.Printf("[github-checkpoint] found cursor key: %s", wm)
		} else if wm, ok := req.Checkpoint["since"].(string); ok && wm != "" {
			sinceWatermark = wm
			log.Printf("[github-checkpoint] found since key: %s", wm)
		} else {
			// Log keys available in checkpoint
			var keys []string
			for k := range req.Checkpoint {
				keys = append(keys, k)
			}
			log.Printf("[github-checkpoint] no watermark found, available keys: %v", keys)
		}
		if sinceWatermark != "" {
			query.Set("since", sinceWatermark)
			query.Set("sort", "updated")
			query.Set("direction", "asc")
			log.Printf("[github-checkpoint] using since=%s for incremental query", sinceWatermark)
		}
	} else {
		log.Printf("[github-checkpoint] checkpoint is nil or not incremental, doing full fetch")
	}

	resp, err := g.Client.Get(ctx, path, query)
	if err != nil {
		return nil, mapHTTPError(err)
	}

	// Some endpoints return an object with items; issues/commits return arrays
	var data any
	if err := resp.JSON(&data); err != nil {
		return nil, err
	}
	records := mapAPIPayload(datasetType, projectKey, data)

	// CHECKPOINT FIX: Track high watermark from records
	// Use the IncrementalCursor field (e.g., "updatedAt") to find the latest value
	highWatermark := sinceWatermark
	cursorField := def.IncrementalCursor
	if cursorField != "" {
		for _, rec := range records {
			if ts, ok := rec[cursorField].(string); ok && ts > highWatermark {
				highWatermark = ts
			}
		}
		log.Printf("[github-checkpoint] extracted highWatermark=%q from %d records using cursorField=%s", highWatermark, len(records), cursorField)
	}

	return &recordIterator{
		records:       records,
		highWatermark: highWatermark,
		cursorField:   cursorField,
	}, nil
}

func mapAPIPayload(datasetType, projectKey string, payload any) []endpoint.Record {
	var out []endpoint.Record
	switch v := payload.(type) {
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				out = append(out, mapSingleRecord(datasetType, projectKey, m))
			}
		}
	case map[string]any:
		// Some endpoints wrap array in "items"
		if items, ok := v["items"].([]any); ok {
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					out = append(out, mapSingleRecord(datasetType, projectKey, m))
				}
			}
		}
	}
	return out
}

func mapSingleRecord(datasetType, projectKey string, m map[string]any) endpoint.Record {
	record := endpoint.Record{}
	record["_projectKey"] = projectKey
	record["_datasetType"] = datasetType
	switch datasetType {
	case "github.repos":
		record["repoId"] = asString(m["node_id"])
		record["name"] = asString(m["name"])
		record["fullName"] = asString(m["full_name"])
		record["owner"] = asString(fromMap(m, "owner", "login"))
		record["defaultBranch"] = asString(m["default_branch"])
		record["visibility"] = asString(m["visibility"])
		record["description"] = asString(m["description"])
		record["htmlUrl"] = asString(m["html_url"])
		record["apiUrl"] = asString(m["url"])
		record["language"] = asString(m["language"])
		record["stargazersCount"] = asInt(m["stargazers_count"])
		record["forksCount"] = asInt(m["forks_count"])
		record["createdAt"] = asString(m["created_at"])
		record["updatedAt"] = asString(m["updated_at"])
	case "github.issues":
		record["_entity"] = "github.issues"
		record["issueId"] = asString(m["node_id"])
		record["number"] = asInt(m["number"])
		record["repo"] = projectKey
		record["title"] = asString(m["title"])
		record["body"] = asString(m["body"])
		record["state"] = asString(m["state"])
		record["author"] = asString(fromMap(m, "user", "login"))
		record["assignees"] = m["assignees"]
		record["labels"] = m["labels"]
		record["milestone"] = asString(fromMap(m, "milestone", "title"))
		record["htmlUrl"] = asString(m["html_url"])
		record["commentsCount"] = asInt(m["comments"])
		record["createdAt"] = asString(m["created_at"])
		record["updatedAt"] = asString(m["updated_at"])
		record["closedAt"] = asString(m["closed_at"])
	case "github.pull_requests":
		record["prId"] = asString(m["node_id"])
		record["number"] = asInt(m["number"])
		record["repo"] = projectKey
		record["title"] = asString(m["title"])
		record["body"] = asString(m["body"])
		record["state"] = asString(m["state"])
		record["author"] = asString(fromMap(m, "user", "login"))
		record["assignees"] = m["assignees"]
		record["labels"] = m["labels"]
		record["headBranch"] = asString(fromMap(m, "head", "ref"))
		record["baseBranch"] = asString(fromMap(m, "base", "ref"))
		record["htmlUrl"] = asString(m["html_url"])
		record["merged"] = m["merged"]
		record["mergedAt"] = asString(m["merged_at"])
		record["mergedBy"] = asString(fromMap(m, "merged_by", "login"))
		record["createdAt"] = asString(m["created_at"])
		record["updatedAt"] = asString(m["updated_at"])
		record["closedAt"] = asString(m["closed_at"])
	case "github.commits":
		record["sha"] = asString(m["sha"])
		record["repo"] = projectKey
		record["message"] = asString(fromMap(m, "commit", "message"))
		author := asString(fromMap(m, "author", "login"))
		if author == "" {
			author = asString(fromMap(fromMap(m, "commit"), "author", "name"))
		}
		record["author"] = author
		record["authorEmail"] = asString(fromMap(fromMap(m, "commit"), "author", "email"))
		committer := asString(fromMap(m, "committer", "login"))
		if committer == "" {
			committer = asString(fromMap(fromMap(m, "commit"), "committer", "name"))
		}
		record["committer"] = committer
		record["committerEmail"] = asString(fromMap(fromMap(m, "commit"), "committer", "email"))
		record["htmlUrl"] = asString(m["html_url"])
		record["createdAt"] = asString(fromMap(fromMap(m, "commit"), "author", "date"))
		record["committedAt"] = asString(fromMap(fromMap(m, "commit"), "author", "date"))
	case "github.comments":
		record["commentId"] = asString(m["node_id"])
		record["repo"] = projectKey
		issueURL := asString(m["issue_url"])
		if issueURL != "" {
			parts := strings.Split(strings.TrimSuffix(issueURL, "/"), "/")
			if len(parts) > 0 {
				if n, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
					record["issueNumber"] = n
				}
			}
		}
		record["author"] = asString(fromMap(m, "user", "login"))
		record["body"] = asString(m["body"])
		record["htmlUrl"] = asString(m["html_url"])
		record["createdAt"] = asString(m["created_at"])
		record["updatedAt"] = asString(m["updated_at"])
	case "github.releases":
		record["releaseId"] = asString(m["node_id"])
		record["repo"] = projectKey
		record["tagName"] = asString(m["tag_name"])
		record["name"] = asString(m["name"])
		record["body"] = asString(m["body"])
		record["author"] = asString(fromMap(m, "author", "login"))
		record["draft"] = m["draft"]
		record["prerelease"] = m["prerelease"]
		record["htmlUrl"] = asString(m["html_url"])
		record["tarballUrl"] = asString(m["tarball_url"])
		record["zipballUrl"] = asString(m["zipball_url"])
		record["createdAt"] = asString(m["created_at"])
		record["publishedAt"] = asString(m["published_at"])
	default:
		for k, v := range m {
			record[k] = v
		}
	}
	return record
}

func (g *GitHub) fetchContent(ctx context.Context, repo Repo, path string, ref string) (FileContent, error) {
	reqPath := fmt.Sprintf("/repos/%s/contents/%s", repo.ProjectKey(), strings.TrimPrefix(path, "/"))
	query := url.Values{}
	if ref != "" {
		query["ref"] = []string{ref}
	}
	resp, err := g.Client.Get(ctx, reqPath, query)
	if err != nil {
		return FileContent{}, mapHTTPError(err)
	}
	var payload contentResponse
	if err := resp.JSON(&payload); err != nil {
		return FileContent{}, err
	}

	data, err := decodeContent(payload.Content, payload.Encoding)
	if err != nil {
		return FileContent{}, err
	}

	return FileContent{
		Path:    payload.Path,
		SHA:     payload.SHA,
		Size:    payload.Size,
		Data:    data,
		HTMLURL: payload.HTMLURL,
	}, nil
}

type Repo struct {
	Owner         string
	Name          string
	DefaultBranch string
	HTMLURL       string
	APIURL        string
	Visibility    string
	UpdatedAt     time.Time
	Files         []treeEntry
}

func (r Repo) ProjectKey() string {
	return strings.ToLower(fmt.Sprintf("%s/%s", r.Owner, r.Name))
}

type repoResponse struct {
	Name          string      `json:"name"`
	FullName      string      `json:"full_name"`
	DefaultBranch string      `json:"default_branch"`
	HTMLURL       string      `json:"html_url"`
	URL           string      `json:"url"`
	Visibility    string      `json:"visibility"`
	Owner         ownerInfo   `json:"owner"`
	UpdatedAt     string      `json:"updated_at"`
	Files         []treeEntry `json:"tree,omitempty"`
}

type ownerInfo struct {
	Login string `json:"login"`
}

type treeResponse struct {
	Tree      []treeEntry `json:"tree"`
	Truncated bool        `json:"truncated"`
}

type treeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
	Size int64  `json:"size"`
}

type contentResponse struct {
	Path     string `json:"path"`
	SHA      string `json:"sha"`
	Size     int64  `json:"size"`
	HTMLURL  string `json:"html_url"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
	Type     string `json:"type"`
}

type FileContent struct {
	Path    string
	SHA     string
	Size    int64
	Data    []byte
	HTMLURL string
}

func (c FileContent) Text() string {
	return string(c.Data)
}

type recordIterator struct {
	records       []endpoint.Record
	index         int
	highWatermark string // Tracks latest timestamp for checkpoint
	cursorField   string // Field name for cursor (e.g., "updatedAt")
}

func (it *recordIterator) Next() bool {
	return it.index < len(it.records)
}

func (it *recordIterator) Value() endpoint.Record {
	if it.index >= len(it.records) {
		return nil
	}
	val := it.records[it.index]
	it.index++
	return val
}

func (it *recordIterator) Err() error   { return nil }
func (it *recordIterator) Close() error { return nil }

// Checkpoint returns the checkpoint with high watermark for incremental reads.
// This is used by the ingestion framework to persist the watermark for next run.
func (it *recordIterator) Checkpoint() *endpoint.Checkpoint {
	if it.highWatermark == "" {
		return nil
	}
	return &endpoint.Checkpoint{
		Watermark: it.highWatermark,
		Metadata: map[string]any{
			"cursorField": it.cursorField,
			"recordCount": len(it.records),
		},
	}
}

type githubError struct {
	code      string
	message   string
	retryable bool
}

func (e *githubError) Error() string {
	if e == nil {
		return ""
	}
	if e.message != "" {
		return e.message
	}
	return e.code
}

func (e *githubError) CodeValue() string     { return e.code }
func (e *githubError) RetryableStatus() bool { return e.retryable }

func mapHTTPError(err error) error {
	if err == nil {
		return nil
	}
	if ghErr, ok := err.(*githubError); ok {
		return ghErr
	}
	if httpErr, ok := err.(*http.HTTPError); ok {
		switch httpErr.StatusCode {
		case 401, 403:
			return &githubError{code: "E_AUTH_INVALID", retryable: false, message: httpErr.Error()}
		case 404:
			return &githubError{code: "E_NOT_FOUND", retryable: false, message: httpErr.Error()}
		case 429:
			return &githubError{code: "E_RATE_LIMITED", retryable: true, message: httpErr.Error()}
		default:
			if httpErr.IsServerError() {
				return &githubError{code: "E_ENDPOINT_UNREACHABLE", retryable: true, message: httpErr.Error()}
			}
		}
	}
	return err
}

func isRetryableError(err error) bool {
	var gh *githubError
	if ok := AsGithubError(err, &gh); ok {
		return gh.retryable
	}
	return false
}

// AsGithubError allows using errors.As without importing errors here.
func AsGithubError(err error, target **githubError) bool {
	switch v := err.(type) {
	case *githubError:
		*target = v
		return true
	}
	return false
}

func buildDatasetID(tenantID, projectKey string) string {
	if tenantID == "" {
		tenantID = "tenant-github"
	}
	return fmt.Sprintf("catalog.dataset:code.repo:%s:%s", tenantID, projectKey)
}

func parseDatasetProject(datasetID, fallbackTenant string) (string, string) {
	if datasetID == "" {
		return fallbackTenant, ""
	}
	parts := strings.Split(datasetID, ":")
	if len(parts) >= 3 {
		tenant := parts[len(parts)-2]
		project := parts[len(parts)-1]
		return tenant, project
	}
	// Handle unitIds like "github.octocat/hello-world/issues" (no tenant prefix)
	if strings.Contains(datasetID, "/") {
		trimmed := strings.TrimPrefix(datasetID, "github.")
		slashParts := strings.Split(trimmed, "/")
		if len(slashParts) >= 2 {
			project := strings.ToLower(strings.Join(slashParts[:2], "/"))
			return fallbackTenant, project
		}
	}
	if strings.Contains(datasetID, "/") {
		return fallbackTenant, datasetID
	}
	return fallbackTenant, datasetID
}

func decodeContent(body string, encoding string) ([]byte, error) {
	if encoding == "base64" {
		return base64.StdEncoding.DecodeString(strings.TrimSpace(body))
	}
	return []byte(body), nil
}

func datasetTypePrefix(datasetID string) string {
	if datasetID == "" {
		return ""
	}
	parts := strings.Split(datasetID, ":")
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}

func fromMap(m any, keys ...string) any {
	cur := m
	for _, k := range keys {
		if k == "" {
			continue
		}
		if obj, ok := cur.(map[string]any); ok {
			cur = obj[k]
		} else {
			return nil
		}
	}
	return cur
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
			return parsed
		}
	}
	return 0
}

func isLikelyBinary(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	if !utf8.Valid(data) {
		return true
	}
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}

func chunkText(text string, chunkBytes int, overlap int) []string {
	if chunkBytes <= 0 {
		return []string{text}
	}
	if overlap < 0 {
		overlap = 0
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return nil
	}

	var chunks []string
	for start := 0; start < len(runes); {
		end := start + chunkBytes
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
		if end == len(runes) {
			break
		}
		start = end - overlap
		if start < 0 {
			start = 0
		}
	}
	return chunks
}

func detectLanguage(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".go"):
		return "Go"
	case strings.HasSuffix(lower, ".ts"), strings.HasSuffix(lower, ".tsx"):
		return "TypeScript"
	case strings.HasSuffix(lower, ".js"):
		return "JavaScript"
	case strings.HasSuffix(lower, ".md"):
		return "Markdown"
	case strings.HasSuffix(lower, ".py"):
		return "Python"
	default:
		return "text"
	}
}

func matchesExtension(path string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	lower := strings.ToLower(path)
	for _, ext := range allowed {
		if strings.HasSuffix(lower, strings.ToLower(strings.TrimSpace(ext))) {
			return true
		}
	}
	return false
}

func toSet(values []string) map[string]bool {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[strings.ToLower(strings.TrimSpace(v))] = true
	}
	return out
}

// ============================================================================
// VectorProfileProvider Implementation
// ============================================================================

// GetVectorProfile returns the appropriate vector profile ID for a given entity kind.
// This is used by staging to determine how to normalize records for vector indexing.
func (g *GitHub) GetVectorProfile(entityKind string) string {
	switch entityKind {
	case "code.file_chunk":
		return "source.github.code.v1"
	case "github.issues", "work.item":
		return "source.github.issues.v1"
	case "github.pull_requests":
		return "source.github.prs.v1"
	case "github.commits":
		return "source.github.commits.v1"
	default:
		return "source.github.generic.v1"
	}
}

// NormalizeForIndex transforms a raw ingestion record into a VectorIndexRecord
// suitable for embedding by brain-worker. Returns false if record cannot be indexed.
func (g *GitHub) NormalizeForIndex(rec endpoint.Record) (endpoint.VectorIndexRecord, bool) {
	entityKind := asString(rec["_entity"])
	if entityKind == "" {
		// Check nested payload for entityType
		if payload, ok := rec["payload"].(map[string]any); ok {
			entityKind = asString(payload["entityType"])
		}
	}

	switch entityKind {
	case "code.file_chunk":
		return g.normalizeCodeChunk(rec)
	case "github.issues":
		return g.normalizeIssue(rec)
	case "github.pull_requests":
		return g.normalizePR(rec)
	default:
		return endpoint.VectorIndexRecord{}, false
	}
}

func (g *GitHub) normalizeCodeChunk(rec endpoint.Record) (endpoint.VectorIndexRecord, bool) {
	repo := asString(rec["repo"])
	if repo == "" {
		repo = asString(rec["_projectKey"])
	}
	path := asString(rec["path"])
	sha := asString(rec["sha"])
	chunkIdx := asInt(rec["chunkIndex"])
	text := asString(rec["text"])

	if repo == "" || path == "" || text == "" {
		return endpoint.VectorIndexRecord{}, false
	}

	nodeID := fmt.Sprintf("code:github:%s:%s:%d", repo, path, chunkIdx)
	return endpoint.VectorIndexRecord{
		NodeID:       nodeID,
		ProfileID:    "source.github.code.v1",
		EntityKind:   "code.file_chunk",
		Text:         text,
		SourceFamily: "github",
		TenantID:     asString(rec["_tenantId"]),
		ProjectKey:   repo,
		SourceURL:    asString(rec["_sourceUrl"]),
		ExternalID:   asString(rec["_externalId"]),
		Metadata: map[string]any{
			"repo":       repo,
			"path":       path,
			"sha":        sha,
			"chunkIndex": chunkIdx,
			"language":   asString(rec["language"]),
		},
	}, true
}

func (g *GitHub) normalizeIssue(rec endpoint.Record) (endpoint.VectorIndexRecord, bool) {
	// Handle nested payload structure from staging
	var payload map[string]any
	if p, ok := rec["payload"].(map[string]any); ok {
		if nested, ok := p["payload"].(map[string]any); ok {
			payload = nested // nested structure: payload.payload.*
		} else {
			payload = p
		}
	} else {
		payload = rec // flat structure
	}

	issueID := asString(payload["issueId"])
	if issueID == "" {
		issueID = fmt.Sprintf("%d", asInt(payload["number"]))
	}
	title := asString(payload["title"])
	body := asString(payload["body"])
	repo := asString(payload["repo"])
	if repo == "" {
		repo = asString(payload["_projectKey"])
	}

	if issueID == "" || title == "" || repo == "" {
		return endpoint.VectorIndexRecord{}, false
	}

	// Combine title and body for text content
	text := strings.TrimSpace(fmt.Sprintf("%s\n\n%s", title, body))
	nodeID := fmt.Sprintf("work:github:%s:issue:%s", repo, issueID)

	return endpoint.VectorIndexRecord{
		NodeID:       nodeID,
		ProfileID:    "source.github.issues.v1",
		EntityKind:   "work.item",
		Text:         text,
		SourceFamily: "github",
		TenantID:     asString(rec["_tenantId"]),
		ProjectKey:   repo,
		SourceURL:    asString(payload["htmlUrl"]),
		ExternalID:   issueID,
		Metadata: map[string]any{
			"issueId": issueID,
			"repo":    repo,
			"state":   asString(payload["state"]),
			"author":  asString(payload["author"]),
		},
	}, true
}

func (g *GitHub) normalizePR(rec endpoint.Record) (endpoint.VectorIndexRecord, bool) {
	prID := asString(rec["prId"])
	if prID == "" {
		prID = fmt.Sprintf("%d", asInt(rec["number"]))
	}
	title := asString(rec["title"])
	body := asString(rec["body"])
	repo := asString(rec["repo"])
	if repo == "" {
		repo = asString(rec["_projectKey"])
	}

	if prID == "" || title == "" || repo == "" {
		return endpoint.VectorIndexRecord{}, false
	}

	text := strings.TrimSpace(fmt.Sprintf("%s\n\n%s", title, body))
	nodeID := fmt.Sprintf("work:github:%s:pr:%s", repo, prID)

	return endpoint.VectorIndexRecord{
		NodeID:       nodeID,
		ProfileID:    "source.github.prs.v1",
		EntityKind:   "work.item",
		Text:         text,
		SourceFamily: "github",
		TenantID:     asString(rec["_tenantId"]),
		ProjectKey:   repo,
		SourceURL:    asString(rec["htmlUrl"]),
		ExternalID:   prID,
		Metadata: map[string]any{
			"prId":       prID,
			"repo":       repo,
			"state":      asString(rec["state"]),
			"author":     asString(rec["author"]),
			"headBranch": asString(rec["headBranch"]),
			"baseBranch": asString(rec["baseBranch"]),
		},
	}, true
}
