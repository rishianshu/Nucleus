package graphrag

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ===================================================
// GraphRAG gRPC Service
// Implements GraphRAGService from graphrag.proto
// ===================================================

// Service implements the GraphRAGService gRPC interface.
type Service struct {
	contextBuilder    ContextBuilder
	graphExpander     GraphExpander
	communityProvider CommunityProvider
	embeddingProvider EmbeddingProvider
}

// NewService creates a new GraphRAG service.
func NewService(
	contextBuilder ContextBuilder,
	graphExpander GraphExpander,
	communityProvider CommunityProvider,
	embeddingProvider EmbeddingProvider,
) *Service {
	return &Service{
		contextBuilder:    contextBuilder,
		graphExpander:     graphExpander,
		communityProvider: communityProvider,
		embeddingProvider: embeddingProvider,
	}
}

// ===================================================
// BuildContext RPC
// ===================================================

// BuildContextRequest represents the incoming request.
type BuildContextRequest struct {
	TenantID         string
	Query            string
	QueryEmbedding   []float32
	TopK             int
	MinScore         float32
	VectorWeight     float32
	KeywordWeight    float32
	MaxHops          int
	MaxNodesPerHop   int
	MaxTotalNodes    int
	EdgeTypes        []string
	IncludeCommunities bool
	MaxCommunities   int
	IncludeContent   bool
	MaxContentLength int
	ProjectID        string
	ProfileIDs       []string
	EntityKinds      []string
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
		TopK:               req.TopK,
		ScoreThreshold:     req.MinScore,
		QueryEmbedding:     req.QueryEmbedding,
		VectorWeight:       req.VectorWeight,
		KeywordWeight:      req.KeywordWeight,
		// Filter settings
		ProjectID:          req.ProjectID,
		ProfileIDs:         req.ProfileIDs,
		EntityKinds:        req.EntityKinds,
		// Expansion settings
		MaxHops:            req.MaxHops,
		MaxNodesPerHop:     req.MaxNodesPerHop,
		MaxTotalNodes:      req.MaxTotalNodes,
		EdgeTypes:          req.EdgeTypes,
		// Community settings
		IncludeCommunities: req.IncludeCommunities,
		MaxCommunities:     req.MaxCommunities,
		// Content settings
		IncludeContent:     req.IncludeContent,
		MaxContentLength:   req.MaxContentLength,
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
		Query:        ctx.Query,
		TenantID:     ctx.TenantID,
		GeneratedAt:  timestamppb.New(ctx.GeneratedAt),
		SeedEntities: toProtoEntityMatches(ctx.SeedEntities),
		ExpandedGraph: toProtoGraphExpansion(ctx.ExpandedGraph),
		Communities:  toProtoCommunitySummaries(ctx.Communities),
		Lineage:      ctx.Lineage,
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
			Name:           c.Label,       // CommunitySummary uses Label
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
