package graphrag

import (
	"context"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ===================================================
// GraphRAG gRPC Service
// Implements GraphRAGService from graphrag.proto
// ===================================================

// LLMProvider abstracts the LLM backend for answer generation.
type LLMProvider interface {
	// Complete sends a prompt and returns the completion.
	Complete(ctx context.Context, prompt string, options LLMCompletionOptions) (string, error)
	// Name returns the provider name.
	Name() string
}

// LLMCompletionOptions configures the LLM completion.
type LLMCompletionOptions struct {
	Model        string  `json:"model"`
	MaxTokens    int     `json:"maxTokens"`
	Temperature  float32 `json:"temperature"`
	SystemPrompt string  `json:"systemPrompt"`
}

// Service implements the GraphRAGService gRPC interface.
type Service struct {
	contextBuilder    ContextBuilder
	graphExpander     GraphExpander
	communityProvider CommunityProvider
	embeddingProvider EmbeddingProvider
	llmProvider       LLMProvider // Optional: nil falls back to mock
}

// NewService creates a new GraphRAG service.
// llmProvider can be nil for mock mode.
func NewService(
	contextBuilder ContextBuilder,
	graphExpander GraphExpander,
	communityProvider CommunityProvider,
	embeddingProvider EmbeddingProvider,
	llmProvider LLMProvider,
) *Service {
	return &Service{
		contextBuilder:    contextBuilder,
		graphExpander:     graphExpander,
		communityProvider: communityProvider,
		embeddingProvider: embeddingProvider,
		llmProvider:       llmProvider,
	}
}

// ===================================================
// BuildContext RPC
// ===================================================

// BuildContextRequest represents the incoming request.
type BuildContextRequest struct {
	TenantID           string
	Query              string
	QueryEmbedding     []float32
	TopK               int
	MinScore           float32
	VectorWeight       float32
	KeywordWeight      float32
	MaxHops            int
	MaxNodesPerHop     int
	MaxTotalNodes      int
	EdgeTypes          []string
	IncludeCommunities bool
	MaxCommunities     int
	IncludeContent     bool
	MaxContentLength   int
	ProjectID          string
	ProfileIDs         []string
	EntityKinds        []string
}

// BuildContextResponse represents the response.
type BuildContextResponse struct {
	Context         *RAGContext
	SearchTimeMs    float32
	ExpansionTimeMs float32
	CommunityTimeMs float32
	TotalTimeMs     float32
}

// BuildContext creates a complete RAG context for a query.
func (s *Service) BuildContext(ctx context.Context, req *BuildContextRequest) (*BuildContextResponse, error) {
	start := time.Now()

	// Validate request
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.Query == "" {
		return nil, status.Error(codes.InvalidArgument, "query is required")
	}
	if s.contextBuilder == nil {
		return nil, status.Error(codes.FailedPrecondition, "context builder not configured")
	}

	// Build configuration - forward all search parameters
	// NOTE: Zero-valued fields will have defaults applied by applyContextBuilderDefaults
	// inside DefaultContextBuilder.BuildContext
	config := ContextBuilderConfig{
		// Search settings
		TopK:           req.TopK,
		ScoreThreshold: req.MinScore,
		QueryEmbedding: req.QueryEmbedding,
		VectorWeight:   req.VectorWeight,
		KeywordWeight:  req.KeywordWeight,
		// Filter settings
		ProjectID:   req.ProjectID,
		ProfileIDs:  req.ProfileIDs,
		EntityKinds: req.EntityKinds,
		// Expansion settings
		MaxHops:        req.MaxHops,
		MaxNodesPerHop: req.MaxNodesPerHop,
		MaxTotalNodes:  req.MaxTotalNodes,
		EdgeTypes:      req.EdgeTypes,
		// Community settings
		IncludeCommunities: req.IncludeCommunities,
		MaxCommunities:     req.MaxCommunities,
		// Content settings
		IncludeContent:   req.IncludeContent,
		MaxContentLength: req.MaxContentLength,
	}

	// Build context
	ragCtx, err := s.contextBuilder.BuildContext(ctx, req.TenantID, req.Query, config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build context: %v", err)
	}

	return &BuildContextResponse{
		Context:     ragCtx,
		TotalTimeMs: float32(time.Since(start).Milliseconds()),
	}, nil
}

// ===================================================
// GenerateAnswer RPC
// ===================================================

// GenerateAnswerRequest represents the request for grounded answer generation.
type GenerateAnswerRequest struct {
	TenantID  string
	Query     string
	Context   *RAGContext
	Model     string
	MaxTokens int
}

// GroundedAnswer represents the LLM answer with source citations.
type GroundedAnswer struct {
	Answer     string
	Citations  []Citation
	ModelUsed  string
	Confidence float32
	TokensUsed int
}

// Citation captures which sources were used for the answer.
type Citation struct {
	SourceID    string
	SourceType  string
	SourceName  string
	Excerpt     string
	StartOffset int
	EndOffset   int
}

// GenerateAnswer builds an LLM prompt from the RAGContext and returns a mock grounded answer.
func (s *Service) GenerateAnswer(ctx context.Context, req *GenerateAnswerRequest) (*GroundedAnswer, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request is required")
	}
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.Query == "" {
		return nil, status.Error(codes.InvalidArgument, "query is required")
	}
	if req.Context == nil {
		return nil, status.Error(codes.InvalidArgument, "context is required")
	}
	if req.Context.TenantID != req.TenantID {
		return nil, status.Error(codes.PermissionDenied, "context tenant_id does not match request tenant_id")
	}

	// Determine model and max tokens first (used for both prompt and LLM call)
	model := req.Model
	if model == "" {
		model = "gpt-4o-mini"
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}

	// Build prompt from context using defaulted maxTokens
	prompt := buildAnswerPrompt(req.Query, req.Context, maxTokens)

	var answerText string
	var citations []Citation
	var modelUsed string
	var confidence float32

	// Use real LLM if available, otherwise fall back to mock
	if s.llmProvider != nil {
		opts := LLMCompletionOptions{
			Model:     model,
			MaxTokens: maxTokens,
			Temperature: 0.3,
			SystemPrompt: "You are a helpful assistant that answers questions based on the provided context. " +
				"Always ground your answers in the context and cite sources where applicable.",
		}
		llmResponse, err := s.llmProvider.Complete(ctx, prompt, opts)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "LLM completion failed: %v", err)
		}
		answerText = llmResponse
		// For real LLM responses, generate citations from context entities without text offsets
		// (offsets are only meaningful for deterministic mock answers)
		citations = generateContextCitations(req.Context)
		modelUsed = fmt.Sprintf("%s/%s", s.llmProvider.Name(), model)
		confidence = 0.85 // Higher confidence with real LLM
	} else {
		// Mock mode: use placeholder answer
		answerText, citations = mockGroundedAnswer(req.Query, req.Context)
		modelUsed = "mock-graphrag-llm"
		confidence = 0.5 // Lower confidence for mock responses
	}

	return &GroundedAnswer{
		Answer:     answerText,
		Citations:  citations,
		ModelUsed:  modelUsed,
		Confidence: confidence,
		TokensUsed: estimateTokens(prompt, answerText),
	}, nil
}

// buildAnswerPrompt formats the provided RAG context into an LLM-ready prompt.
func buildAnswerPrompt(query string, ragCtx *RAGContext, maxTokens int) string {
	var b strings.Builder

	b.WriteString("Use the graph-derived context to answer the query with citations.\n")
	b.WriteString(fmt.Sprintf("Query: %s\n\n", query))

	if len(ragCtx.SeedEntities) > 0 {
		b.WriteString("Seed Entities:\n")
		for _, e := range ragCtx.SeedEntities {
			b.WriteString(fmt.Sprintf("- %s (%s) score=%.2f: %s\n",
				defaultString(e.Name, e.ID),
				e.Type,
				e.Score,
				truncateText(firstNonEmpty(e.Description, e.Content), 200),
			))
		}
		b.WriteString("\n")
	}

	if ragCtx.ExpandedGraph != nil {
		if len(ragCtx.ExpandedGraph.Nodes) > 0 {
			b.WriteString("Graph Nodes:\n")
			for _, n := range ragCtx.ExpandedGraph.Nodes {
				b.WriteString(fmt.Sprintf("- %s [%s] hop:%d\n", nodeDisplayName(n), n.Type, n.HopDistance))
			}
			b.WriteString("\n")
		}
		if len(ragCtx.ExpandedGraph.Edges) > 0 {
			b.WriteString("Graph Relationships:\n")
			labels := buildNodeLabelLookup(ragCtx)
			for _, e := range ragCtx.ExpandedGraph.Edges {
				from := labels[e.FromID]
				if from == "" {
					from = e.FromID
				}
				to := labels[e.ToID]
				if to == "" {
					to = e.ToID
				}
				b.WriteString(fmt.Sprintf("- %s -[%s]-> %s (dir=%s)\n", from, e.Type, to, edgeDirectionToString(e.Direction)))
			}
			b.WriteString("\n")
		}
	}

	if len(ragCtx.Communities) > 0 {
		b.WriteString("Communities:\n")
		for _, c := range ragCtx.Communities {
			b.WriteString(fmt.Sprintf("- %s (level %d, size %d): %s\n",
				c.Label, c.Level, c.Size, truncateText(c.Description, 200)))
		}
	}

	prompt := b.String()
	if maxTokens > 0 {
		maxChars := maxTokens * 4
		if len(prompt) > maxChars {
			prompt = prompt[:maxChars] + "..."
		}
	}
	return prompt
}

// mockGroundedAnswer produces a deterministic answer and citations until LLM integration.
func mockGroundedAnswer(query string, ragCtx *RAGContext) (string, []Citation) {
	var b strings.Builder
	citations := make([]Citation, 0)

	b.WriteString(fmt.Sprintf("Mock grounded answer for \"%s\" using the provided graph context.", query))

	if len(ragCtx.SeedEntities) > 0 {
		b.WriteString(" Key entities: ")
		typeLookup := buildNodeTypeLookup(ragCtx)
		limit := len(ragCtx.SeedEntities)
		if limit > 3 {
			limit = 3
		}
		for i := 0; i < limit; i++ {
			e := ragCtx.SeedEntities[i]
			if i > 0 {
				if i == limit-1 {
					b.WriteString(" and ")
				} else {
					b.WriteString(", ")
				}
			}
			name := defaultString(e.Name, e.ID)
			start := b.Len()
			b.WriteString(name)
			if e.Type != "" {
				b.WriteString(fmt.Sprintf(" (%s)", e.Type))
			}
			end := b.Len()
			citations = append(citations, Citation{
				SourceID:    e.ID,
				SourceType:  typeLookup[e.ID],
				SourceName:  name,
				Excerpt:     truncateText(firstNonEmpty(e.Description, e.Content), 200),
				StartOffset: start,
				EndOffset:   end,
			})
		}
		b.WriteString(".")
	}

	if ragCtx.ExpandedGraph != nil && len(ragCtx.ExpandedGraph.Edges) > 0 {
		b.WriteString(" Relationships observed include ")
		labels := buildNodeLabelLookup(ragCtx)
		typeLookup := buildNodeTypeLookup(ragCtx)
		limit := len(ragCtx.ExpandedGraph.Edges)
		if limit > 2 {
			limit = 2
		}
		for i := 0; i < limit; i++ {
			edge := ragCtx.ExpandedGraph.Edges[i]
			if i > 0 {
				b.WriteString("; ")
			}
			from := defaultString(labels[edge.FromID], edge.FromID)
			to := defaultString(labels[edge.ToID], edge.ToID)
			relation := fmt.Sprintf("%s %s %s", from, edge.Type, to)
			start := b.Len()
			b.WriteString(relation)
			end := b.Len()

			// Track source positions for the involved nodes.
			citations = append(citations, Citation{
				SourceID:    edge.FromID,
				SourceType:  typeLookup[edge.FromID],
				SourceName:  from,
				Excerpt:     fmt.Sprintf("Connected to %s via %s", to, edge.Type),
				StartOffset: start,
				EndOffset:   start + len(from),
			})
			citations = append(citations, Citation{
				SourceID:    edge.ToID,
				SourceType:  typeLookup[edge.ToID],
				SourceName:  to,
				Excerpt:     fmt.Sprintf("Connected from %s via %s", from, edge.Type),
				StartOffset: end - len(to),
				EndOffset:   end,
			})
		}
		b.WriteString(".")
	}

	if len(ragCtx.Communities) > 0 {
		community := ragCtx.Communities[0]
		b.WriteString(" Community context: ")
		start := b.Len()
		b.WriteString(community.Label)
		end := b.Len()
		b.WriteString(" highlights shared themes.")
		citations = append(citations, Citation{
			SourceID:    community.ID,
			SourceType:  "community",
			SourceName:  community.Label,
			Excerpt:     truncateText(community.Description, 200),
			StartOffset: start,
			EndOffset:   end,
		})
	}

	return b.String(), citations
}

func buildNodeLabelLookup(ctx *RAGContext) map[string]string {
	labels := make(map[string]string)
	for _, e := range ctx.SeedEntities {
		labels[e.ID] = defaultString(e.Name, e.ID)
	}
	if ctx.ExpandedGraph != nil {
		for _, n := range ctx.ExpandedGraph.Nodes {
			labels[n.ID] = nodeDisplayName(n)
		}
	}
	return labels
}

func buildNodeTypeLookup(ctx *RAGContext) map[string]string {
	types := make(map[string]string)
	for _, e := range ctx.SeedEntities {
		types[e.ID] = e.Type
	}
	if ctx.ExpandedGraph != nil {
		for _, n := range ctx.ExpandedGraph.Nodes {
			types[n.ID] = n.Type
		}
	}
	return types
}

// generateContextCitations creates citations from RAG context entities without text offsets.
// Used for real LLM responses where answer text is not deterministic.
func generateContextCitations(ctx *RAGContext) []Citation {
	var citations []Citation
	seen := make(map[string]bool)

	// Add citations from seed entities
	for _, e := range ctx.SeedEntities {
		if seen[e.ID] {
			continue
		}
		seen[e.ID] = true
		citations = append(citations, Citation{
			SourceID:   e.ID,
			SourceType: e.Type,
			SourceName: defaultString(e.Name, e.ID),
			Excerpt:    truncateText(firstNonEmpty(e.Description, e.Content), 100),
			// No offsets for LLM-generated text
		})
	}

	// Add citations from expanded graph nodes
	if ctx.ExpandedGraph != nil {
		for _, n := range ctx.ExpandedGraph.Nodes {
			if seen[n.ID] {
				continue
			}
			seen[n.ID] = true
			name := n.ID
			if n.Properties != nil {
				name = defaultString(n.Properties["name"], n.Properties["label"])
			}
			if name == "" {
				name = n.ID
			}
			citations = append(citations, Citation{
				SourceID:   n.ID,
				SourceType: n.Type,
				SourceName: name,
				Excerpt:    truncateText(n.Properties["description"], 100),
				// No offsets for LLM-generated text
			})
		}
	}

	return citations
}

func nodeDisplayName(n GraphNode) string {
	if n.Properties != nil {
		if name := n.Properties["name"]; name != "" {
			return name
		}
		if label := n.Properties["label"]; label != "" {
			return label
		}
	}
	if n.Type != "" {
		return fmt.Sprintf("%s (%s)", n.ID, n.Type)
	}
	return n.ID
}

func estimateTokens(prompt, answer string) int {
	return (len(prompt) + len(answer)) / 4
}

func truncateText(s string, maxLen int) string {
	if maxLen <= 0 || len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// ===================================================
// ExpandGraph RPC
// ===================================================

// ExpandGraphRequest represents the expand graph request.
type ExpandGraphRequest struct {
	TenantID       string
	SeedIDs        []string
	MaxHops        int
	MaxNodesPerHop int
	MaxTotalNodes  int
	EdgeTypes      []string
	Direction      string
}

// ExpandGraphResponse represents the expand graph response.
type ExpandGraphResponse struct {
	Expansion *GraphExpansion
	TimeMs    float32
}

// ExpandGraph performs graph expansion from seed nodes.
func (s *Service) ExpandGraph(ctx context.Context, req *ExpandGraphRequest) (*ExpandGraphResponse, error) {
	start := time.Now()

	// Validate request
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if len(req.SeedIDs) == 0 {
		return nil, status.Error(codes.InvalidArgument, "seed_ids is required")
	}
	if s.graphExpander == nil {
		return nil, status.Error(codes.FailedPrecondition, "graph expander not configured")
	}

	// Build configuration
	direction := EdgeDirectionAny
	switch req.Direction {
	case "out":
		direction = EdgeDirectionOutgoing
	case "in":
		direction = EdgeDirectionIncoming
	}

	// P2 Fix: Apply defaults for zero-valued expansion config
	maxHops := req.MaxHops
	if maxHops <= 0 {
		maxHops = 2
	}
	maxNodesPerHop := req.MaxNodesPerHop
	if maxNodesPerHop <= 0 {
		maxNodesPerHop = 20
	}
	maxTotalNodes := req.MaxTotalNodes
	if maxTotalNodes <= 0 {
		maxTotalNodes = 100
	}

	config := ExpansionConfig{
		MaxHops:        maxHops,
		MaxNodesPerHop: maxNodesPerHop,
		MaxTotalNodes:  maxTotalNodes,
		EdgeTypes:      req.EdgeTypes,
		Direction:      direction,
	}

	// Expand graph
	expansion, err := s.graphExpander.Expand(ctx, req.TenantID, req.SeedIDs, config)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to expand graph: %v", err)
	}

	return &ExpandGraphResponse{
		Expansion: expansion,
		TimeMs:    float32(time.Since(start).Milliseconds()),
	}, nil
}

// ===================================================
// GetEntityCommunities RPC
// ===================================================

// GetEntityCommunitiesRequest represents the get communities request.
type GetEntityCommunitiesRequest struct {
	TenantID       string
	EntityIDs      []string
	MaxCommunities int
}

// GetEntityCommunitiesResponse represents the get communities response.
type GetEntityCommunitiesResponse struct {
	Communities []CommunitySummary
}

// GetEntityCommunities retrieves communities for given entities.
func (s *Service) GetEntityCommunities(ctx context.Context, req *GetEntityCommunitiesRequest) (*GetEntityCommunitiesResponse, error) {
	// Validate request
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if len(req.EntityIDs) == 0 {
		return nil, status.Error(codes.InvalidArgument, "entity_ids is required")
	}
	if s.communityProvider == nil {
		return nil, status.Error(codes.FailedPrecondition, "community provider not configured")
	}

	// Get communities
	maxCommunities := req.MaxCommunities
	if maxCommunities <= 0 {
		maxCommunities = 5
	}

	communities, err := s.communityProvider.GetCommunitiesForEntities(ctx, req.TenantID, req.EntityIDs, maxCommunities)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get communities: %v", err)
	}

	return &GetEntityCommunitiesResponse{
		Communities: communities,
	}, nil
}

// ===================================================
// Proto Conversion Helpers
// ===================================================

// ToProtoRAGContext converts internal RAGContext to proto format.
func ToProtoRAGContext(ctx *RAGContext) *ProtoRAGContext {
	if ctx == nil {
		return nil
	}

	return &ProtoRAGContext{
		Query:         ctx.Query,
		TenantID:      ctx.TenantID,
		GeneratedAt:   timestamppb.New(ctx.GeneratedAt),
		SeedEntities:  toProtoEntityMatches(ctx.SeedEntities),
		ExpandedGraph: toProtoGraphExpansion(ctx.ExpandedGraph),
		Communities:   toProtoCommunitySummaries(ctx.Communities),
		Lineage:       ctx.Lineage,
	}
}

// ProtoRAGContext is the proto representation of RAGContext.
type ProtoRAGContext struct {
	Query         string
	TenantID      string
	GeneratedAt   *timestamppb.Timestamp
	SeedEntities  []*ProtoEntityMatch
	ExpandedGraph *ProtoGraphExpansion
	Communities   []*ProtoCommunitySummary
	Lineage       []string
}

// ProtoEntityMatch is the proto representation of EntityMatch.
type ProtoEntityMatch struct {
	ID          string
	Type        string
	Name        string
	Description string
	Score       float32
	Content     string
	Properties  map[string]string
	Metadata    map[string]string
	ProfileID   string
	HopDistance int32
}

// ProtoGraphExpansion is the proto representation of GraphExpansion.
type ProtoGraphExpansion struct {
	Nodes      []*ProtoGraphNode
	Edges      []*ProtoGraphEdge
	TotalNodes int32
	TotalEdges int32
	MaxHops    int32
}

// ProtoGraphNode is the proto representation of GraphNode.
type ProtoGraphNode struct {
	ID          string
	Type        string
	Name        string
	Properties  map[string]string
	Content     string
	HopDistance int32
	ProfileID   string
}

// ProtoGraphEdge is the proto representation of GraphEdge.
type ProtoGraphEdge struct {
	ID         string
	FromID     string
	ToID       string
	Type       string
	Properties map[string]string
	Weight     float32
	Direction  string
}

// ProtoCommunitySummary is the proto representation of CommunitySummary.
type ProtoCommunitySummary struct {
	ID             string
	Name           string
	Description    string
	Level          int32
	MemberCount    int32
	RelevanceScore float32
	MemberIDs      []string
}

// Helper conversion functions
func toProtoEntityMatches(matches []EntityMatch) []*ProtoEntityMatch {
	result := make([]*ProtoEntityMatch, len(matches))
	for i, m := range matches {
		result[i] = &ProtoEntityMatch{
			ID:          m.ID,
			Type:        m.Type,
			Name:        m.Name,
			Description: m.Description,
			Score:       m.Score,
			Content:     m.Content,
			Properties:  m.Properties,
			Metadata:    m.Metadata,
			ProfileID:   m.ProfileID,
			HopDistance: int32(m.HopDistance),
		}
	}
	return result
}

func toProtoGraphExpansion(exp *GraphExpansion) *ProtoGraphExpansion {
	if exp == nil {
		return nil
	}

	nodes := make([]*ProtoGraphNode, len(exp.Nodes))
	for i, n := range exp.Nodes {
		nodes[i] = &ProtoGraphNode{
			ID:          n.ID,
			Type:        n.Type,
			Name:        "", // GraphNode doesn't have Name
			Properties:  n.Properties,
			Content:     "", // GraphNode doesn't have Content
			HopDistance: int32(n.HopDistance),
			ProfileID:   "", // GraphNode doesn't have ProfileID
		}
	}

	edges := make([]*ProtoGraphEdge, len(exp.Edges))
	for i, e := range exp.Edges {
		edges[i] = &ProtoGraphEdge{
			ID:         e.ID,
			FromID:     e.FromID,
			ToID:       e.ToID,
			Type:       e.Type,
			Properties: e.Properties,
			Weight:     float32(e.Weight),
			Direction:  edgeDirectionToString(e.Direction),
		}
	}

	return &ProtoGraphExpansion{
		Nodes:      nodes,
		Edges:      edges,
		TotalNodes: int32(exp.TotalNodes),
		TotalEdges: int32(exp.TotalEdges),
		MaxHops:    int32(exp.MaxHops),
	}
}

func toProtoCommunitySummaries(communities []CommunitySummary) []*ProtoCommunitySummary {
	result := make([]*ProtoCommunitySummary, len(communities))
	for i, c := range communities {
		result[i] = &ProtoCommunitySummary{
			ID:             c.ID,
			Name:           c.Label, // CommunitySummary uses Label
			Description:    c.Description,
			Level:          int32(c.Level),
			MemberCount:    int32(c.Size), // CommunitySummary uses Size
			RelevanceScore: 0,             // CommunitySummary doesn't have RelevanceScore
			MemberIDs:      c.MemberIDs,
		}
	}
	return result
}

// edgeDirectionToString converts EdgeDirection enum to string.
func edgeDirectionToString(d EdgeDirection) string {
	switch d {
	case EdgeDirectionOutgoing:
		return "out"
	case EdgeDirectionIncoming:
		return "in"
	default:
		return "any"
	}
}
