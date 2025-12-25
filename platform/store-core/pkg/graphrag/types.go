package graphrag

import (
	"context"
	"time"
)

// ===================================================
// GraphRAG Types and Interfaces
// Combines vector search with knowledge graph expansion
// for multi-hop reasoning and contextual retrieval
// ===================================================

// RAGContext represents the complete context for RAG queries.
// Combines vector search seeds with graph expansion and community context.
type RAGContext struct {
	// Query information
	Query           string    `json:"query"`
	TenantID        string    `json:"tenantId"`
	GeneratedAt     time.Time `json:"generatedAt"`

	// Vector search seeds
	SeedEntities    []EntityMatch      `json:"seedEntities"`

	// Graph expansion results
	ExpandedGraph   *GraphExpansion    `json:"expandedGraph"`

	// Community context
	Communities     []CommunitySummary `json:"communities"`

	// Lineage for tracing
	Lineage         []string           `json:"lineage"`

	// Processing stats
	ProcessingTime  time.Duration      `json:"processingTime"`
}

// EntityMatch represents a vector search result entity.
type EntityMatch struct {
	ID          string             `json:"id"`
	Type        string             `json:"type"`
	Name        string             `json:"name"`        // Display name
	Description string             `json:"description"` // Entity description  
	Score       float32            `json:"score"`       // Similarity score (combined RRF)
	Content     string             `json:"content"`     // Text content
	Embedding   []float32          `json:"embedding"`   // Optional embedding
	Properties  map[string]string  `json:"properties"`
	Metadata    map[string]string  `json:"metadata"`    // Additional metadata from search
	ProfileID   string             `json:"profileId"`   // Profile/source identifier
	HopDistance int                `json:"hopDistance"` // 0 for seeds, >0 for expanded
}

// GraphExpansion represents the result of KG traversal.
type GraphExpansion struct {
	// Nodes discovered through graph traversal
	Nodes           []GraphNode        `json:"nodes"`
	
	// Edges connecting the nodes
	Edges           []GraphEdge        `json:"edges"`
	
	// Statistics
	TotalNodes      int                `json:"totalNodes"`
	TotalEdges      int                `json:"totalEdges"`
	MaxHops         int                `json:"maxHops"`
	
	// Grouping by hop distance
	NodesByHop      map[int][]string   `json:"nodesByHop"` // hop -> node IDs
}

// GraphNode represents a node in the expanded graph.
type GraphNode struct {
	ID          string             `json:"id"`
	Type        string             `json:"type"`
	Properties  map[string]string  `json:"properties"`
	HopDistance int                `json:"hopDistance"`
	Centrality  float64            `json:"centrality"` // Optional centrality score
}

// GraphEdge represents an edge in the expanded graph.
type GraphEdge struct {
	ID          string             `json:"id"`
	Type        string             `json:"type"`
	FromID      string             `json:"fromId"`
	ToID        string             `json:"toId"`
	Properties  map[string]string  `json:"properties"`
	Weight      float64            `json:"weight"`
	Direction   EdgeDirection      `json:"direction"`
}

// EdgeDirection indicates edge traversal direction.
type EdgeDirection int

const (
	EdgeDirectionAny EdgeDirection = iota
	EdgeDirectionOutgoing
	EdgeDirectionIncoming
)

// CommunitySummary provides context from community detection.
type CommunitySummary struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Keywords    []string `json:"keywords"`
	Size        int      `json:"size"`
	Level       int      `json:"level"`
	MemberIDs   []string `json:"memberIds"` // IDs of relevant members
}

// ===================================================
// Configuration
// ===================================================

// ContextBuilderConfig configures the RAG context building process.
type ContextBuilderConfig struct {
	// Search settings
	TopK              int       `json:"topK"`              // Number of seed entities
	ScoreThreshold    float32   `json:"scoreThreshold"`    // Minimum similarity score
	QueryEmbedding    []float32 `json:"queryEmbedding"`    // Pre-computed embedding (optional)
	VectorWeight      float32   `json:"vectorWeight"`      // Weight for vector search (0-1)
	KeywordWeight     float32   `json:"keywordWeight"`     // Weight for keyword/FTS (0-1)

	// Filter settings
	ProjectID         string    `json:"projectId"`         // Optional project filter
	ProfileIDs        []string  `json:"profileIds"`        // Optional profile filters
	EntityKinds       []string  `json:"entityKinds"`       // Optional entity kind filters

	// Graph expansion settings
	MaxHops           int       `json:"maxHops"`           // Maximum traversal depth
	MaxNodesPerHop    int       `json:"maxNodesPerHop"`    // Limit per hop level
	MaxTotalNodes     int       `json:"maxTotalNodes"`     // Total expansion limit
	EdgeTypes         []string  `json:"edgeTypes"`         // Filter to specific edge types

	// Community settings
	IncludeCommunities bool     `json:"includeCommunities"` // Include community context
	MaxCommunities     int      `json:"maxCommunities"`     // Max communities to include

	// Content settings
	IncludeContent    bool      `json:"includeContent"`    // Include text content
	MaxContentLength  int       `json:"maxContentLength"`  // Truncate content
}

// DefaultContextBuilderConfig returns sensible defaults.
func DefaultContextBuilderConfig() ContextBuilderConfig {
	return ContextBuilderConfig{
		TopK:              10,
		ScoreThreshold:    0.5,
		MaxHops:           3,
		MaxNodesPerHop:    20,
		MaxTotalNodes:     100,
		EdgeTypes:         nil, // All edge types
		IncludeCommunities: true,
		MaxCommunities:    5,
		IncludeContent:    true,
		MaxContentLength:  500,
	}
}

// ExpansionConfig configures just the graph expansion phase.
type ExpansionConfig struct {
	MaxHops        int      `json:"maxHops"`
	MaxNodesPerHop int      `json:"maxNodesPerHop"`
	MaxTotalNodes  int      `json:"maxTotalNodes"`
	EdgeTypes      []string `json:"edgeTypes"`
	Direction      EdgeDirection `json:"direction"`
}

// DefaultExpansionConfig returns defaults for expansion.
func DefaultExpansionConfig() ExpansionConfig {
	return ExpansionConfig{
		MaxHops:        3,
		MaxNodesPerHop: 20,
		MaxTotalNodes:  100,
		EdgeTypes:      nil,
		Direction:      EdgeDirectionAny,
	}
}

// ===================================================
// Interfaces
// ===================================================

// ContextBuilder builds RAG context from queries.
type ContextBuilder interface {
	// BuildContext creates a complete RAG context for a query.
	BuildContext(ctx context.Context, tenantID, query string, config ContextBuilderConfig) (*RAGContext, error)
}

// GraphExpander traverses the knowledge graph.
type GraphExpander interface {
	// Expand traverses the graph from seed nodes.
	Expand(ctx context.Context, tenantID string, seedIDs []string, config ExpansionConfig) (*GraphExpansion, error)
	
	// GetNeighbors gets immediate neighbors of a node.
	GetNeighbors(ctx context.Context, tenantID, nodeID string, edgeTypes []string, limit int) ([]GraphNode, []GraphEdge, error)
}

// HybridSearcher performs combined vector + keyword search with RRF fusion.
// This integrates with the existing hybridsearch.Searcher for full-text search support.
type HybridSearcher interface {
	// Search performs hybrid search returning entities matching the query.
	// Uses vector similarity + FTS keyword matching with RRF fusion.
	Search(ctx context.Context, tenantID, query string, embedding []float32, config HybridSearchConfig) ([]EntityMatch, error)
}

// HybridSearchConfig configures the hybrid search behavior.
type HybridSearchConfig struct {
	TopK          int     `json:"topK"`          // Max results to return
	VectorWeight  float32 `json:"vectorWeight"`  // Weight for vector search (0-1)
	KeywordWeight float32 `json:"keywordWeight"` // Weight for keyword/FTS search (0-1)
	MinScore      float32 `json:"minScore"`      // Minimum combined score threshold
	ProjectID     string  `json:"projectId"`     // Optional project filter
	ProfileIDs    []string `json:"profileIds"`   // Optional profile filters
	EntityKinds   []string `json:"entityKinds"`  // Optional entity kind filters
}

// DefaultHybridSearchConfig returns sensible defaults.
func DefaultHybridSearchConfig() HybridSearchConfig {
	return HybridSearchConfig{
		TopK:          20,
		VectorWeight:  0.5,
		KeywordWeight: 0.5,
		MinScore:      0.0,
	}
}

// CommunityProvider provides community context.
type CommunityProvider interface {
	// GetCommunitiesForEntities returns relevant communities.
	GetCommunitiesForEntities(ctx context.Context, tenantID string, entityIDs []string, maxCommunities int) ([]CommunitySummary, error)
}

// KGClient is a simplified interface for KG operations used by GraphRAG.
// Maps to the KgServiceClient from ucl-core/pkg/kgpb.
type KGClient interface {
	// GetNode retrieves a single node.
	GetNode(ctx context.Context, tenantID, nodeID string) (*GraphNode, error)
	
	// ListNeighbors returns neighboring nodes.
	// P2 Fix: Added direction parameter for directional traversal.
	ListNeighbors(ctx context.Context, tenantID, nodeID string, edgeTypes []string, direction EdgeDirection, limit int) ([]GraphNode, []GraphEdge, error)
	
	// ListEdges returns edges for a node.
	ListEdges(ctx context.Context, tenantID, sourceID, targetID string, edgeTypes []string, limit int) ([]GraphEdge, error)
}

// ===================================================
// Helper Functions
// ===================================================

// NewRAGContext creates a new empty RAG context.
func NewRAGContext(tenantID, query string) *RAGContext {
	return &RAGContext{
		Query:          query,
		TenantID:       tenantID,
		GeneratedAt:    time.Now(),
		SeedEntities:   make([]EntityMatch, 0),
		ExpandedGraph:  &GraphExpansion{
			Nodes:      make([]GraphNode, 0),
			Edges:      make([]GraphEdge, 0),
			NodesByHop: make(map[int][]string),
		},
		Communities:    make([]CommunitySummary, 0),
		Lineage:        make([]string, 0),
	}
}

// AddSeed adds a seed entity to the context.
func (rc *RAGContext) AddSeed(entity EntityMatch) {
	entity.HopDistance = 0
	rc.SeedEntities = append(rc.SeedEntities, entity)
	rc.Lineage = append(rc.Lineage, entity.ID)
}

// AddExpandedNode adds an expanded node to the graph.
func (rc *RAGContext) AddExpandedNode(node GraphNode) {
	// P1 Fix: Initialize ExpandedGraph if nil
	if rc.ExpandedGraph == nil {
		rc.ExpandedGraph = &GraphExpansion{
			Nodes:      make([]GraphNode, 0),
			Edges:      make([]GraphEdge, 0),
			NodesByHop: make(map[int][]string),
		}
	}
	
	rc.ExpandedGraph.Nodes = append(rc.ExpandedGraph.Nodes, node)
	rc.ExpandedGraph.TotalNodes++
	
	if rc.ExpandedGraph.NodesByHop == nil {
		rc.ExpandedGraph.NodesByHop = make(map[int][]string)
	}
	rc.ExpandedGraph.NodesByHop[node.HopDistance] = append(
		rc.ExpandedGraph.NodesByHop[node.HopDistance], 
		node.ID,
	)
	
	if node.HopDistance > rc.ExpandedGraph.MaxHops {
		rc.ExpandedGraph.MaxHops = node.HopDistance
	}
}

// AddCommunity adds a community summary to the context.
func (rc *RAGContext) AddCommunity(community CommunitySummary) {
	rc.Communities = append(rc.Communities, community)
}

// GetAllNodeIDs returns all node IDs in the context.
func (rc *RAGContext) GetAllNodeIDs() []string {
	seen := make(map[string]bool)
	result := make([]string, 0)
	
	for _, e := range rc.SeedEntities {
		if !seen[e.ID] {
			seen[e.ID] = true
			result = append(result, e.ID)
		}
	}
	
	// P1 Fix: Guard against nil ExpandedGraph
	if rc.ExpandedGraph != nil {
		for _, n := range rc.ExpandedGraph.Nodes {
			if !seen[n.ID] {
				seen[n.ID] = true
				result = append(result, n.ID)
			}
		}
	}
	
	return result
}

// ToPromptContext formats the RAG context for LLM prompts.
func (rc *RAGContext) ToPromptContext(maxLength int) string {
	var content string
	
	// Add seed entities
	for _, e := range rc.SeedEntities {
		if e.Content != "" {
			content += e.Content + "\n\n"
		}
	}
	
	// P1 Fix: Guard against nil ExpandedGraph
	if rc.ExpandedGraph != nil {
		for _, n := range rc.ExpandedGraph.Nodes {
			if summary, ok := n.Properties["summary"]; ok && summary != "" {
				content += summary + "\n"
			}
		}
	}
	
	// Add community descriptions
	for _, c := range rc.Communities {
		if c.Description != "" {
			content += "Topic: " + c.Label + " - " + c.Description + "\n"
		}
	}
	
	// Truncate if needed
	if maxLength > 0 && len(content) > maxLength {
		content = content[:maxLength] + "..."
	}
	
	return content
}
