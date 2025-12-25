package community

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"time"
)

// LeidenDetector implements hierarchical community detection using the Leiden algorithm.
// Leiden improves upon Louvain by guaranteeing well-connected communities.
type LeidenDetector struct {
	config LeidenConfig
	rng    *rand.Rand
}

// NewLeidenDetector creates a new Leiden community detector.
func NewLeidenDetector(config LeidenConfig) *LeidenDetector {
	seed := config.RandomSeed
	if seed == 0 {
		seed = time.Now().UnixNano()
	}
	return &LeidenDetector{
		config: config,
		rng:    rand.New(rand.NewSource(seed)),
	}
}

// Detect runs Leiden community detection on the graph.
// Returns hierarchical communities at multiple resolution levels.
func (l *LeidenDetector) Detect(ctx context.Context, graph Graph, config LeidenConfig) (*LeidenResult, error) {
	start := time.Now()

	// P2 Fix: Always use the provided config (allows per-run customization)
	l.config = config

	// Build adjacency from edges
	adj := l.buildAdjacency(graph)

	// Initial partition: each node in its own community
	partition := make(map[string]string)
	for _, node := range graph.Nodes {
		partition[node.ID] = node.ID
	}

	// Multi-level Leiden
	allCommunities := make([]Community, 0)
	allMemberships := make([]CommunityMember, 0)
	var finalModularity float64

	// Track current graph for each level
	currentGraph := graph

	for level := 0; level < l.config.NumLevels; level++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Run Leiden at current resolution
		partition, finalModularity = l.leidenPhase(adj, partition, l.adjustedResolution(level))

		// Refine phase (Leiden improvement over Louvain)
		partition = l.refinePartition(adj, partition)

		// Extract communities for this level
		// P1 Fix: Use currentGraph which corresponds to this level
		levelCommunities, levelMemberships := l.extractCommunities(
			currentGraph, partition, CommunityLevel(level), finalModularity,
		)

		// Filter by min size
		filtered := make([]Community, 0)
		membershipSet := make(map[string]bool)
		for _, c := range levelCommunities {
			if c.Size >= l.config.MinCommunitySize {
				filtered = append(filtered, c)
				membershipSet[c.ID] = true
			}
		}

		// Only include memberships for kept communities
		for _, m := range levelMemberships {
			if membershipSet[m.CommunityID] {
				allMemberships = append(allMemberships, m)
			}
		}

		allCommunities = append(allCommunities, filtered...)

		// Build hierarchy: aggregate for next level
		if level < l.config.NumLevels-1 {
			var newGraph Graph
			adj, partition, newGraph = l.aggregateGraph(adj, partition)
			currentGraph = newGraph
		}
	}

	// Set parent relationships
	l.setParentRelationships(allCommunities)

	return &LeidenResult{
		Communities:    allCommunities,
		Memberships:    allMemberships,
		Modularity:     finalModularity,
		NumLevels:      l.config.NumLevels,
		ProcessingTime: time.Since(start),
	}, nil
}

// buildAdjacency converts edges to adjacency list with weights.
func (l *LeidenDetector) buildAdjacency(graph Graph) map[string]map[string]float64 {
	adj := make(map[string]map[string]float64)

	// Initialize all nodes
	for _, node := range graph.Nodes {
		adj[node.ID] = make(map[string]float64)
	}

	// Add edges (undirected)
	for _, edge := range graph.Edges {
		if edge.Weight >= l.config.SimilarityThreshold {
			adj[edge.Source][edge.Target] = edge.Weight
			adj[edge.Target][edge.Source] = edge.Weight
		}
	}

	return adj
}

// leidenPhase runs the main Leiden optimization phase.
func (l *LeidenDetector) leidenPhase(
	adj map[string]map[string]float64,
	partition map[string]string,
	resolution float64,
) (map[string]string, float64) {
	// Shuffle nodes for randomization
	nodes := l.getNodes(adj)
	l.shuffle(nodes)

	improved := true
	for iter := 0; iter < l.config.MaxIterations && improved; iter++ {
		improved = false

		for _, node := range nodes {
			currentComm := partition[node]
			bestComm := currentComm
			bestDelta := 0.0

			// Try moving to neighbor communities
			neighborComms := l.getNeighborCommunities(adj, partition, node)

			for comm := range neighborComms {
				if comm == currentComm {
					continue
				}

				delta := l.modularityDelta(adj, partition, node, currentComm, comm, resolution)
				if delta > bestDelta {
					bestDelta = delta
					bestComm = comm
				}
			}

			if bestComm != currentComm && bestDelta > 0 {
				partition[node] = bestComm
				improved = true
			}
		}
	}

	modularity := l.calculateModularity(adj, partition, resolution)
	return partition, modularity
}

// refinePartition implements Leiden's refinement phase.
// Unlike Louvain, this ensures communities remain well-connected.
func (l *LeidenDetector) refinePartition(
	adj map[string]map[string]float64,
	partition map[string]string,
) map[string]string {
	// Group nodes by community
	communities := make(map[string][]string)
	for node, comm := range partition {
		communities[comm] = append(communities[comm], node)
	}

	refined := make(map[string]string)
	for node := range partition {
		refined[node] = partition[node]
	}

	// For each community, check connectivity
	for comm, members := range communities {
		if len(members) <= 1 {
			continue
		}

		// Find connected components within community
		components := l.findComponents(adj, members)

		// Split disconnected components
		for i, component := range components {
			if i == 0 {
				continue // First component keeps original ID
			}
			newComm := comm + "_" + string(rune('a'+i))
			for _, node := range component {
				refined[node] = newComm
			}
		}
	}

	return refined
}

// findComponents finds connected components within a set of nodes.
func (l *LeidenDetector) findComponents(adj map[string]map[string]float64, nodes []string) [][]string {
	nodeSet := make(map[string]bool)
	for _, n := range nodes {
		nodeSet[n] = true
	}

	visited := make(map[string]bool)
	var components [][]string

	for _, start := range nodes {
		if visited[start] {
			continue
		}

		// BFS from start
		component := []string{}
		queue := []string{start}
		visited[start] = true

		for len(queue) > 0 {
			node := queue[0]
			queue = queue[1:]
			component = append(component, node)

			for neighbor := range adj[node] {
				if nodeSet[neighbor] && !visited[neighbor] {
					visited[neighbor] = true
					queue = append(queue, neighbor)
				}
			}
		}

		components = append(components, component)
	}

	return components
}

// aggregateGraph creates a coarsened graph for next level.
// P1 Fix: Now returns a Graph struct and includes self-loops for intra-community weight.
func (l *LeidenDetector) aggregateGraph(
	adj map[string]map[string]float64,
	partition map[string]string,
) (map[string]map[string]float64, map[string]string, Graph) {
	// Build community adjacency
	commAdj := make(map[string]map[string]float64)

	// Get unique communities
	communities := make(map[string]bool)
	for _, comm := range partition {
		communities[comm] = true
		if commAdj[comm] == nil {
			commAdj[comm] = make(map[string]float64)
		}
	}


	// Aggregate edge weights between and within communities
	// Note: adj is symmetric, so each edge (A,B) is seen twice.
	// We accumulate into commAdj which also becomes symmetric.
	for node, neighbors := range adj {
		nodeComm := partition[node]
		for neighbor, weight := range neighbors {
			neighborComm := partition[neighbor]
			if nodeComm != neighborComm {
				// Inter-community edge - accumulate symmetric (no divide)
				commAdj[nodeComm][neighborComm] += weight
			} else {
				// Intra-community edge - accumulate for self-loop
				// Self-loop becomes commAdj[c][c] which is symmetric by definition
				commAdj[nodeComm][nodeComm] += weight
			}
		}
	}

	// New partition: each community is its own node
	newPartition := make(map[string]string)
	for comm := range communities {
		newPartition[comm] = comm
	}

	// Build new Graph struct for next level
	newNodes := make([]Node, 0, len(communities))
	for comm := range communities {
		newNodes = append(newNodes, Node{
			ID:    comm,
			Label: comm,
			Type:  "community",
		})
	}

	newEdges := make([]Edge, 0)
	for src, neighbors := range commAdj {
		for dst, weight := range neighbors {
			if src <= dst { // Avoid duplicates for undirected
				newEdges = append(newEdges, Edge{
					Source: src,
					Target: dst,
					Weight: weight,
				})
			}
		}
	}

	newGraph := Graph{
		Nodes: newNodes,
		Edges: newEdges,
	}

	return commAdj, newPartition, newGraph
}

// extractCommunities converts partition to Community structs.
func (l *LeidenDetector) extractCommunities(
	graph Graph,
	partition map[string]string,
	level CommunityLevel,
	modularity float64,
) ([]Community, []CommunityMember) {
	// Group nodes by community
	commMembers := make(map[string][]string)
	for node, comm := range partition {
		commMembers[comm] = append(commMembers[comm], node)
	}

	// Build node lookup
	nodeMap := make(map[string]Node)
	for _, n := range graph.Nodes {
		nodeMap[n.ID] = n
	}

	communities := make([]Community, 0, len(commMembers))
	memberships := make([]CommunityMember, 0, len(partition))
	now := time.Now()

	for commID, members := range commMembers {
		// Calculate centroid
		var centroid []float32
		for _, memberID := range members {
			if node, ok := nodeMap[memberID]; ok && len(node.Embedding) > 0 {
				if centroid == nil {
					centroid = make([]float32, len(node.Embedding))
				}
				for i, v := range node.Embedding {
					centroid[i] += v
				}
			}
		}
		if centroid != nil {
			for i := range centroid {
				centroid[i] /= float32(len(members))
			}
		}

		community := Community{
			ID:         commID,
			Level:      level,
			Size:       len(members),
			Modularity: modularity,
			Centroid:   centroid,
			Temporal: CommunityTemporalMeta{
				FirstSeen:    now,
				LastSeen:     now,
				LastActivity: now,
			},
		}
		communities = append(communities, community)

		// Create memberships
		for _, memberID := range members {
			memberships = append(memberships, CommunityMember{
				EntityID:    memberID,
				CommunityID: commID,
				JoinedAt:    now,
				Centrality:  1.0 / float64(len(members)), // Simple uniform centrality
			})
		}
	}

	return communities, memberships
}

// setParentRelationships links communities across levels.
func (l *LeidenDetector) setParentRelationships(communities []Community) {
	// Sort by level descending (children before parents)
	sort.Slice(communities, func(i, j int) bool {
		return communities[i].Level > communities[j].Level
	})

	// Map child comm IDs to parent comm IDs
	// Parent is the base ID before any suffix
	for i := range communities {
		if communities[i].Level > 0 {
			// Find parent at level-1
			for j := range communities {
				if communities[j].Level == communities[i].Level-1 {
					// Check if this is a parent (simplified: same ID prefix)
					if isParentOf(communities[j].ID, communities[i].ID) {
						communities[i].ParentID = communities[j].ID
						break
					}
				}
			}
		}
	}
}

// Helper functions

func (l *LeidenDetector) getNodes(adj map[string]map[string]float64) []string {
	nodes := make([]string, 0, len(adj))
	for node := range adj {
		nodes = append(nodes, node)
	}
	return nodes
}

func (l *LeidenDetector) shuffle(nodes []string) {
	l.rng.Shuffle(len(nodes), func(i, j int) {
		nodes[i], nodes[j] = nodes[j], nodes[i]
	})
}

func (l *LeidenDetector) getNeighborCommunities(
	adj map[string]map[string]float64,
	partition map[string]string,
	node string,
) map[string]bool {
	comms := make(map[string]bool)
	comms[partition[node]] = true
	for neighbor := range adj[node] {
		comms[partition[neighbor]] = true
	}
	return comms
}

func (l *LeidenDetector) modularityDelta(
	adj map[string]map[string]float64,
	partition map[string]string,
	node, fromComm, toComm string,
	resolution float64,
) float64 {
	// Simplified modularity delta calculation
	var m float64 // Total edge weight
	for _, neighbors := range adj {
		for _, w := range neighbors {
			m += w
		}
	}
	m /= 2

	if m == 0 {
		return 0
	}

	// Sum of weights to/from each community
	var ki, sumIn, sumOut float64
	for neighbor, w := range adj[node] {
		ki += w
		if partition[neighbor] == toComm {
			sumIn += w
		}
		if partition[neighbor] == fromComm {
			sumOut += w
		}
	}

	// Community degrees
	var degIn, degOut float64
	for n := range adj {
		if partition[n] == toComm {
			for _, w := range adj[n] {
				degIn += w
			}
		}
		if partition[n] == fromComm {
			for _, w := range adj[n] {
				degOut += w
			}
		}
	}

	delta := (sumIn - sumOut) / m
	delta -= resolution * ki * (degIn - degOut + ki) / (2 * m * m)

	return delta
}

func (l *LeidenDetector) calculateModularity(
	adj map[string]map[string]float64,
	partition map[string]string,
	resolution float64,
) float64 {
	var m float64
	for _, neighbors := range adj {
		for _, w := range neighbors {
			m += w
		}
	}
	m /= 2

	if m == 0 {
		return 0
	}

	var Q float64
	for node, neighbors := range adj {
		nodeComm := partition[node]
		ki := 0.0
		for _, w := range neighbors {
			ki += w
		}

		for neighbor, aij := range neighbors {
			if partition[neighbor] == nodeComm {
				kj := 0.0
				for _, w := range adj[neighbor] {
					kj += w
				}
				Q += aij - resolution*ki*kj/(2*m)
			}
		}
	}

	return Q / (2 * m)
}

func (l *LeidenDetector) adjustedResolution(level int) float64 {
	// Coarser levels use lower resolution for broader communities
	return l.config.Resolution * math.Pow(0.8, float64(level))
}

func isParentOf(parentID, childID string) bool {
	// Simple check: child ID starts with parent ID
	return len(childID) >= len(parentID) && childID[:len(parentID)] == parentID
}

// Ensure interface compliance
var _ CommunityDetector = (*LeidenDetector)(nil)
