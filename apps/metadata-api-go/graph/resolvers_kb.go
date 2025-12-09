// Package graph provides Knowledge Base (KB) GraphQL resolvers.
package graph

import (
	"context"
	"encoding/json"

	"github.com/nucleus/metadata-api/internal/auth"
	"github.com/nucleus/metadata-api/internal/database"
)

// =============================================================================
// KB/GRAPH NODE RESOLVERS
// =============================================================================

// KbNodes returns KB nodes with pagination.
func (r *queryResolver) KbNodes(ctx context.Context, nodeType *string, scope *GraphScopeInput, search *string, first *int, after *string) (*KbNodeConnection, error) {
	authCtx := auth.FromContext(ctx)
	tenantID := "default"
	if authCtx.Subject != "anonymous" {
		tenantID = authCtx.Subject
	}

	var entityTypes []string
	if nodeType != nil {
		entityTypes = []string{*nodeType}
	}

	limit := 25
	if first != nil && *first > 0 {
		limit = *first
	}

	nodes, err := r.db.ListGraphNodes(ctx, tenantID, entityTypes, search, limit+1)
	if err != nil {
		return nil, err
	}

	hasNextPage := len(nodes) > limit
	if hasNextPage {
		nodes = nodes[:limit]
	}

	edges := make([]*KbNodeEdge, len(nodes))
	for i, n := range nodes {
		edges[i] = &KbNodeEdge{
			Cursor: n.ID,
			Node:   mapGraphNodeToGraphQL(n),
		}
	}

	var endCursor *string
	if len(edges) > 0 {
		endCursor = &edges[len(edges)-1].Cursor
	}

	return &KbNodeConnection{
		Edges: edges,
		PageInfo: &PageInfo{
			HasNextPage:     hasNextPage,
			HasPreviousPage: after != nil,
			EndCursor:       endCursor,
		},
		TotalCount: len(edges),
	}, nil
}

// KbNode returns a single KB node by ID.
func (r *queryResolver) KbNode(ctx context.Context, id string) (*KbGraphNode, error) {
	node, err := r.db.GetGraphNode(ctx, id)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, nil
	}
	return mapGraphNodeToGraphQL(node), nil
}

// =============================================================================
// KB/GRAPH EDGE RESOLVERS
// =============================================================================

// KbEdges returns KB edges with pagination.
func (r *queryResolver) KbEdges(ctx context.Context, edgeType *string, edgeTypes []string, direction *GraphEdgeDirection, scope *GraphScopeInput, sourceID *string, targetID *string, first *int, after *string) (*KbEdgeConnection, error) {
	authCtx := auth.FromContext(ctx)
	tenantID := "default"
	if authCtx.Subject != "anonymous" {
		tenantID = authCtx.Subject
	}

	var types []string
	if edgeType != nil {
		types = append(types, *edgeType)
	}
	types = append(types, edgeTypes...)

	limit := 25
	if first != nil && *first > 0 {
		limit = *first
	}

	edges, err := r.db.ListGraphEdges(ctx, tenantID, types, sourceID, targetID, limit+1)
	if err != nil {
		return nil, err
	}

	hasNextPage := len(edges) > limit
	if hasNextPage {
		edges = edges[:limit]
	}

	edgeResults := make([]*KbEdgeEdge, len(edges))
	for i, e := range edges {
		edgeResults[i] = &KbEdgeEdge{
			Cursor: e.ID,
			Node:   mapGraphEdgeToGraphQL(e),
		}
	}

	var endCursor *string
	if len(edgeResults) > 0 {
		endCursor = &edgeResults[len(edgeResults)-1].Cursor
	}

	return &KbEdgeConnection{
		Edges: edgeResults,
		PageInfo: &PageInfo{
			HasNextPage:     hasNextPage,
			HasPreviousPage: after != nil,
			EndCursor:       endCursor,
		},
		TotalCount: len(edgeResults),
	}, nil
}

// =============================================================================
// KB SCENE RESOLVERS
// =============================================================================

// KbScene returns a scene (subgraph) starting from a node.
func (r *queryResolver) KbScene(ctx context.Context, id string, edgeTypes []string, depth *int, limit *int) (*KbScene, error) {
	return r.KbNeighbors(ctx, id, edgeTypes, depth, limit)
}

// KbNeighbors returns neighbors of a node.
func (r *queryResolver) KbNeighbors(ctx context.Context, id string, edgeTypes []string, depth *int, limit *int) (*KbScene, error) {
	authCtx := auth.FromContext(ctx)
	tenantID := "default"
	if authCtx.Subject != "anonymous" {
		tenantID = authCtx.Subject
	}

	maxLimit := 300
	if limit != nil && *limit > 0 && *limit < maxLimit {
		maxLimit = *limit
	}

	// Get the root node
	rootNode, err := r.db.GetGraphNode(ctx, id)
	if err != nil {
		return nil, err
	}

	nodes := []*KbGraphNode{}
	edges := []*KbGraphEdge{}

	if rootNode != nil {
		nodes = append(nodes, mapGraphNodeToGraphQL(rootNode))

		// Get edges from/to this node
		outbound, err := r.db.ListGraphEdges(ctx, tenantID, edgeTypes, &id, nil, maxLimit/2)
		if err != nil {
			return nil, err
		}
		inbound, err := r.db.ListGraphEdges(ctx, tenantID, edgeTypes, nil, &id, maxLimit/2)
		if err != nil {
			return nil, err
		}

		// Collect neighbor IDs
		neighborIDs := make(map[string]bool)
		for _, e := range outbound {
			edges = append(edges, mapGraphEdgeToGraphQL(e))
			neighborIDs[e.TargetEntityID] = true
		}
		for _, e := range inbound {
			edges = append(edges, mapGraphEdgeToGraphQL(e))
			neighborIDs[e.SourceEntityID] = true
		}

		// Get neighbor nodes
		for nid := range neighborIDs {
			if nid == id {
				continue
			}
			node, err := r.db.GetGraphNode(ctx, nid)
			if err == nil && node != nil {
				nodes = append(nodes, mapGraphNodeToGraphQL(node))
			}
		}
	}

	return &KbScene{
		Nodes: nodes,
		Edges: edges,
		Summary: &KbSceneSummary{
			NodeCount: len(nodes),
			EdgeCount: len(edges),
			Truncated: len(nodes) >= maxLimit || len(edges) >= maxLimit,
		},
	}, nil
}

// =============================================================================
// KB FACETS & META
// =============================================================================

// KbFacets returns facet counts.
func (r *queryResolver) KbFacets(ctx context.Context, scope *GraphScopeInput) (*KbFacets, error) {
	// Return empty facets for now - would need aggregation queries
	return &KbFacets{
		NodeTypes: []*KbFacetValue{},
		EdgeTypes: []*KbFacetValue{},
		Projects:  []*KbFacetValue{},
		Domains:   []*KbFacetValue{},
		Teams:     []*KbFacetValue{},
	}, nil
}

// KbMeta returns KB metadata.
func (r *queryResolver) KbMeta(ctx context.Context, scope *GraphScopeInput) (*KbMeta, error) {
	return &KbMeta{
		Version:   "1.0",
		NodeTypes: []*KbNodeType{},
		EdgeTypes: []*KbEdgeType{},
	}, nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func mapGraphNodeToGraphQL(n *database.GraphNode) *KbGraphNode {
	if n == nil {
		return nil
	}

	var properties map[string]interface{}
	if len(n.Properties) > 0 {
		_ = json.Unmarshal(n.Properties, &properties)
	}

	return &KbGraphNode{
		ID:            n.ID,
		TenantID:      n.TenantID,
		ProjectID:     nullableStringPtr(n.ProjectID),
		EntityType:    n.EntityType,
		DisplayName:   n.DisplayName,
		CanonicalPath: nullableStringPtr(n.CanonicalPath),
		SourceSystem:  nullableStringPtr(n.SourceSystem),
		SpecRef:       nullableStringPtr(n.SpecRef),
		Properties:    n.Properties,
		Version:       n.Version,
		Phase:         nullableStringPtr(n.Phase),
		CreatedAt:     n.CreatedAt,
		UpdatedAt:     n.UpdatedAt,
	}
}

func mapGraphEdgeToGraphQL(e *database.GraphEdge) *KbGraphEdge {
	if e == nil {
		return nil
	}

	var confidence *float64
	if e.Confidence.Valid {
		confidence = &e.Confidence.Float64
	}

	return &KbGraphEdge{
		ID:             e.ID,
		TenantID:       e.TenantID,
		ProjectID:      nullableStringPtr(e.ProjectID),
		EdgeType:       e.EdgeType,
		SourceEntityID: e.SourceEntityID,
		TargetEntityID: e.TargetEntityID,
		Confidence:     confidence,
		SpecRef:        nullableStringPtr(e.SpecRef),
		Metadata:       e.Metadata,
		CreatedAt:      e.CreatedAt,
		UpdatedAt:      e.UpdatedAt,
	}
}
