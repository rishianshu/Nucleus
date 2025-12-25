package graphrag

import (
	"context"
	"fmt"
)

// Note: Direction filtering is passed to KGClient.ListNeighbors
// which is responsible for honoring it. The KGClient implementation
// must filter by direction. If direction is EdgeDirectionAny, all
// edges are returned.

// ===================================================
// KG Multi-Hop Expander
// BFS-based graph traversal with depth limiting
// ===================================================

// DefaultExpander implements GraphExpander using BFS traversal.
type DefaultExpander struct {
	kgClient KGClient
}

// NewDefaultExpander creates a new graph expander.
func NewDefaultExpander(kgClient KGClient) *DefaultExpander {
	return &DefaultExpander{
		kgClient: kgClient,
	}
}

// Expand traverses the graph from seed nodes using BFS.
func (e *DefaultExpander) Expand(
	ctx context.Context,
	tenantID string,
	seedIDs []string,
	config ExpansionConfig,
) (*GraphExpansion, error) {
	// P2 Fix: Guard against nil KGClient
	if e.kgClient == nil {
		return nil, fmt.Errorf("KG client not configured")
	}

	if len(seedIDs) == 0 {
		return &GraphExpansion{
			Nodes:      make([]GraphNode, 0),
			Edges:      make([]GraphEdge, 0),
			NodesByHop: make(map[int][]string),
		}, nil
	}

	// Apply defaults
	if config.MaxHops <= 0 {
		config.MaxHops = 3
	}
	if config.MaxNodesPerHop <= 0 {
		config.MaxNodesPerHop = 20
	}
	if config.MaxTotalNodes <= 0 {
		config.MaxTotalNodes = 100
	}

	result := &GraphExpansion{
		Nodes:      make([]GraphNode, 0),
		Edges:      make([]GraphEdge, 0),
		NodesByHop: make(map[int][]string),
		MaxHops:    0,
	}

	// Track visited nodes
	visited := make(map[string]bool)
	
	// BFS queue: node ID and hop distance
	type queueItem struct {
		nodeID string
		hop    int
	}
	queue := make([]queueItem, 0, len(seedIDs))
	
	// Initialize with seed nodes (hop 0)
	// P2 Fix: Only mark visited and queue if GetNode succeeds (edge consistency)
	for _, id := range seedIDs {
		if visited[id] {
			continue
		}
		// Try to get seed node first
		node, err := e.kgClient.GetNode(ctx, tenantID, id)
		if err == nil && node != nil {
			// Only mark visited and queue if node exists
			visited[id] = true
			queue = append(queue, queueItem{nodeID: id, hop: 0})
			node.HopDistance = 0
			result.Nodes = append(result.Nodes, *node)
			result.NodesByHop[0] = append(result.NodesByHop[0], id)
			result.TotalNodes++
		}
		// If node not found, skip - don't mark visited so edges won't reference it
	}

	// BFS traversal
	queueIdx := 0
	for queueIdx < len(queue) {
		// Check total node limit
		if result.TotalNodes >= config.MaxTotalNodes {
			break
		}

		item := queue[queueIdx]
		queueIdx++

		// Stop if we've reached max hops
		if item.hop >= config.MaxHops {
			continue
		}

		nextHop := item.hop + 1
		
		// Get neighbors (P2 Fix: pass direction to honor directional traversal)
		neighbors, edges, err := e.kgClient.ListNeighbors(
			ctx,
			tenantID,
			item.nodeID,
			config.EdgeTypes,
			config.Direction,
			config.MaxNodesPerHop,
		)
		if err != nil {
			// Log error but continue with other nodes
			continue
		}

		// Track nodes added at this hop level
		nodesAtHop := len(result.NodesByHop[nextHop])

		for _, neighbor := range neighbors {
			// Check per-hop limit
			if nodesAtHop >= config.MaxNodesPerHop {
				break
			}
			// Check total limit
			if result.TotalNodes >= config.MaxTotalNodes {
				break
			}

			if !visited[neighbor.ID] {
				visited[neighbor.ID] = true
				nodesAtHop++

				// Add node
				neighbor.HopDistance = nextHop
				result.Nodes = append(result.Nodes, neighbor)
				result.NodesByHop[nextHop] = append(result.NodesByHop[nextHop], neighbor.ID)
				result.TotalNodes++

				// Queue for further expansion
				queue = append(queue, queueItem{nodeID: neighbor.ID, hop: nextHop})

				// Update max hops
				if nextHop > result.MaxHops {
					result.MaxHops = nextHop
				}
			}
		}

		// P2 Fix: Only add edges where both endpoints are in visited (actually added)
		for _, edge := range edges {
			if visited[edge.FromID] && visited[edge.ToID] {
				result.Edges = append(result.Edges, edge)
				result.TotalEdges++
			}
		}
	}

	return result, nil
}

// GetNeighbors gets immediate neighbors of a node.
func (e *DefaultExpander) GetNeighbors(
	ctx context.Context,
	tenantID, nodeID string,
	edgeTypes []string,
	limit int,
) ([]GraphNode, []GraphEdge, error) {
	if e.kgClient == nil {
		return nil, nil, fmt.Errorf("KG client not configured")
	}
	return e.kgClient.ListNeighbors(ctx, tenantID, nodeID, edgeTypes, EdgeDirectionAny, limit)
}

// ===================================================
// Filtered Expander
// Adds filtering capabilities on top of DefaultExpander
// ===================================================

// FilteredExpander wraps DefaultExpander with additional filters.
type FilteredExpander struct {
	*DefaultExpander
	nodeFilter NodeFilter
	edgeFilter EdgeFilter
}

// NodeFilter defines a function to filter nodes during expansion.
type NodeFilter func(node GraphNode) bool

// EdgeFilter defines a function to filter edges during expansion.
type EdgeFilter func(edge GraphEdge) bool

// NewFilteredExpander creates an expander with custom filters.
func NewFilteredExpander(
	kgClient KGClient,
	nodeFilter NodeFilter,
	edgeFilter EdgeFilter,
) *FilteredExpander {
	return &FilteredExpander{
		DefaultExpander: NewDefaultExpander(kgClient),
		nodeFilter:      nodeFilter,
		edgeFilter:      edgeFilter,
	}
}

// Expand traverses the graph with filtering.
func (e *FilteredExpander) Expand(
	ctx context.Context,
	tenantID string,
	seedIDs []string,
	config ExpansionConfig,
) (*GraphExpansion, error) {
	// Get base expansion
	result, err := e.DefaultExpander.Expand(ctx, tenantID, seedIDs, config)
	if err != nil {
		return nil, err
	}

	// Track filtered node IDs for edge pruning
	filteredNodeIDs := make(map[string]bool)

	// Apply node filter if set
	if e.nodeFilter != nil {
		filteredNodes := make([]GraphNode, 0, len(result.Nodes))
		filteredByHop := make(map[int][]string)
		
		for _, node := range result.Nodes {
			if e.nodeFilter(node) {
				filteredNodes = append(filteredNodes, node)
				filteredByHop[node.HopDistance] = append(
					filteredByHop[node.HopDistance],
					node.ID,
				)
				filteredNodeIDs[node.ID] = true
			}
		}
		result.Nodes = filteredNodes
		result.NodesByHop = filteredByHop
		result.TotalNodes = len(filteredNodes)
	} else {
		// No node filter - all nodes are valid for edge pruning
		for _, node := range result.Nodes {
			filteredNodeIDs[node.ID] = true
		}
	}

	// P2 Fix: Always prune edges to removed nodes + apply edge filter
	filteredEdges := make([]GraphEdge, 0, len(result.Edges))
	for _, edge := range result.Edges {
		// Check if both endpoints exist after node filtering
		if !filteredNodeIDs[edge.FromID] || !filteredNodeIDs[edge.ToID] {
			continue
		}
		// Apply edge filter if set
		if e.edgeFilter != nil && !e.edgeFilter(edge) {
			continue
		}
		filteredEdges = append(filteredEdges, edge)
	}
	result.Edges = filteredEdges
	result.TotalEdges = len(filteredEdges)

	// P3 Fix: Recompute MaxHops from filtered nodes
	result.MaxHops = 0
	for _, node := range result.Nodes {
		if node.HopDistance > result.MaxHops {
			result.MaxHops = node.HopDistance
		}
	}

	return result, nil
}

// ===================================================
// Common Filters
// ===================================================

// NodeTypeFilter returns a filter that accepts specific node types.
func NodeTypeFilter(allowedTypes ...string) NodeFilter {
	typeSet := make(map[string]bool)
	for _, t := range allowedTypes {
		typeSet[t] = true
	}
	return func(node GraphNode) bool {
		return typeSet[node.Type]
	}
}

// EdgeTypeFilter returns a filter that accepts specific edge types.
func EdgeTypeFilter(allowedTypes ...string) EdgeFilter {
	typeSet := make(map[string]bool)
	for _, t := range allowedTypes {
		typeSet[t] = true
	}
	return func(edge GraphEdge) bool {
		return typeSet[edge.Type]
	}
}

// MaxHopFilter returns a filter that limits nodes by hop distance.
func MaxHopFilter(maxHop int) NodeFilter {
	return func(node GraphNode) bool {
		return node.HopDistance <= maxHop
	}
}

// Ensure interface compliance
var _ GraphExpander = (*DefaultExpander)(nil)
var _ GraphExpander = (*FilteredExpander)(nil)
