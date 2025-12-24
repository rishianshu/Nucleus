package gateway

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	kgpb "github.com/nucleus/ucl-core/pkg/kgpb"
)

// Kg service backed by Postgres; falls back to in-memory if DB unavailable.
type kgService struct {
	kgpb.UnimplementedKgServiceServer
	repo  kgRepository
	store *kgMemoryStore
}

func NewKgService(db *pgxpool.Pool) kgpb.KgServiceServer {
	var repo kgRepository
	if db != nil {
		repo = newKgPostgresRepo(db)
	}
	mem := newKgMemoryStore()
	return &kgService{repo: repo, store: mem}
}

func (s *kgService) UpsertNode(ctx context.Context, req *kgpb.UpsertNodeRequest) (*kgpb.UpsertNodeResponse, error) {
	_ = ctx
	if req == nil || req.Node == nil {
		return nil, fmt.Errorf("node is required")
	}
	if s.repo != nil {
		if node, err := s.repo.upsertNode(ctx, req); err == nil {
			return &kgpb.UpsertNodeResponse{Node: node}, nil
		}
	}
	node := s.store.upsertNode(req.TenantId, req.ProjectId, req.Node)
	return &kgpb.UpsertNodeResponse{Node: node}, nil
}

func (s *kgService) UpsertEdge(ctx context.Context, req *kgpb.UpsertEdgeRequest) (*kgpb.UpsertEdgeResponse, error) {
	_ = ctx
	if req == nil || req.Edge == nil {
		return nil, fmt.Errorf("edge is required")
	}
	if s.repo != nil {
		if edge, err := s.repo.upsertEdge(ctx, req); err == nil {
			return &kgpb.UpsertEdgeResponse{Edge: edge}, nil
		}
	}
	edge := s.store.upsertEdge(req.TenantId, req.ProjectId, req.Edge)
	return &kgpb.UpsertEdgeResponse{Edge: edge}, nil
}

func (s *kgService) GetNode(ctx context.Context, req *kgpb.GetNodeRequest) (*kgpb.GetNodeResponse, error) {
	_ = ctx
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	if s.repo != nil {
		if node, err := s.repo.getNode(ctx, req); err == nil {
			return &kgpb.GetNodeResponse{Node: node}, nil
		}
	}
	node := s.store.getNode(req.TenantId, req.ProjectId, req.NodeId)
	return &kgpb.GetNodeResponse{Node: node}, nil
}

func (s *kgService) ListNeighbors(ctx context.Context, req *kgpb.ListNeighborsRequest) (*kgpb.ListNeighborsResponse, error) {
	_ = ctx
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	if s.repo != nil {
		if neighbors, err := s.repo.listNeighbors(ctx, req); err == nil {
			return &kgpb.ListNeighborsResponse{Neighbors: neighbors}, nil
		}
	}
	neighbors := s.store.listNeighbors(req.TenantId, req.ProjectId, req.NodeId, req.EdgeTypes, int(req.Limit))
	return &kgpb.ListNeighborsResponse{Neighbors: neighbors}, nil
}

func (s *kgService) ListEntities(ctx context.Context, req *kgpb.ListEntitiesRequest) (*kgpb.ListEntitiesResponse, error) {
	_ = ctx
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	if s.repo != nil {
		if nodes, err := s.repo.listNodes(ctx, req); err == nil {
			return &kgpb.ListEntitiesResponse{Nodes: nodes}, nil
		}
	}
	nodes := s.store.listNodes(req.TenantId, req.ProjectId, req.EntityTypes, int(req.Limit))
	return &kgpb.ListEntitiesResponse{Nodes: nodes}, nil
}

func (s *kgService) ListEdges(ctx context.Context, req *kgpb.ListEdgesRequest) (*kgpb.ListEdgesResponse, error) {
	_ = ctx
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	if s.repo != nil {
		if edges, err := s.repo.listEdges(ctx, req); err == nil {
			return &kgpb.ListEdgesResponse{Edges: edges}, nil
		}
	}
	edges := s.store.listEdges(req.TenantId, req.ProjectId, req.EdgeTypes, req.SourceId, req.TargetId, int(req.Limit))
	return &kgpb.ListEdgesResponse{Edges: edges}, nil
}

// in-memory KG store (per-tenant/project). This is a placeholder.
type kgMemoryStore struct {
	mu     sync.RWMutex
	nodes  map[string]*kgpb.Node
	edges  map[string]*kgpb.Edge
	indexE map[string][]*kgpb.Edge // nodeId -> edges touching it
}

func newKgMemoryStore() *kgMemoryStore {
	return &kgMemoryStore{
		nodes:  make(map[string]*kgpb.Node),
		edges:  make(map[string]*kgpb.Edge),
		indexE: make(map[string][]*kgpb.Edge),
	}
}

func keyTenantProject(tenant, project string) string {
	return tenant + "::" + project
}

func (s *kgMemoryStore) nodeKey(tenant, project, id string) string {
	return keyTenantProject(tenant, project) + "::node::" + id
}

func (s *kgMemoryStore) edgeKey(tenant, project, id string) string {
	return keyTenantProject(tenant, project) + "::edge::" + id
}

func (s *kgMemoryStore) upsertNode(tenant, project string, node *kgpb.Node) *kgpb.Node {
	if node == nil {
		return nil
	}
	k := s.nodeKey(tenant, project, node.Id)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodes[k] = node
	return node
}

func (s *kgMemoryStore) getNode(tenant, project, id string) *kgpb.Node {
	if id == "" {
		return nil
	}
	k := s.nodeKey(tenant, project, id)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n, ok := s.nodes[k]; ok {
		return n
	}
	return nil
}

func (s *kgMemoryStore) upsertEdge(tenant, project string, edge *kgpb.Edge) *kgpb.Edge {
	if edge == nil {
		return nil
	}
	k := s.edgeKey(tenant, project, edge.Id)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.edges[k] = edge
	s.indexE[edge.FromId] = append(s.indexE[edge.FromId], edge)
	s.indexE[edge.ToId] = append(s.indexE[edge.ToId], edge)
	return edge
}

func (s *kgMemoryStore) listNodes(tenant, project string, types []string, limit int) []*kgpb.Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	typeSet := map[string]struct{}{}
	for _, t := range types {
		typeSet[t] = struct{}{}
	}
	var out []*kgpb.Node
	for k, n := range s.nodes {
		if !strings.HasPrefix(k, keyTenantProject(tenant, project)) {
			continue
		}
		if len(typeSet) > 0 {
			if _, ok := typeSet[n.Type]; !ok {
				continue
			}
		}
		out = append(out, n)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func (s *kgMemoryStore) listEdges(tenant, project string, types []string, sourceID, targetID string, limit int) []*kgpb.Edge {
	s.mu.RLock()
	defer s.mu.RUnlock()
	typeSet := map[string]struct{}{}
	for _, t := range types {
		typeSet[t] = struct{}{}
	}
	var out []*kgpb.Edge
	for k, e := range s.edges {
		if !strings.HasPrefix(k, keyTenantProject(tenant, project)) {
			continue
		}
		if len(typeSet) > 0 {
			if _, ok := typeSet[e.Type]; !ok {
				continue
			}
		}
		if sourceID != "" && e.FromId != sourceID {
			continue
		}
		if targetID != "" && e.ToId != targetID {
			continue
		}
		out = append(out, e)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func (s *kgMemoryStore) listNeighbors(tenant, project, nodeID string, edgeTypes []string, limit int) []*kgpb.Node {
	if nodeID == "" {
		return nil
	}
	typeSet := map[string]struct{}{}
	for _, t := range edgeTypes {
		typeSet[t] = struct{}{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	edges := s.indexE[nodeID]
	var out []*kgpb.Node
	for _, e := range edges {
		if len(typeSet) > 0 {
			if _, ok := typeSet[e.Type]; !ok {
				continue
			}
		}
		other := e.FromId
		if other == nodeID {
			other = e.ToId
		}
		nKey := s.nodeKey(tenant, project, other)
		if n, ok := s.nodes[nKey]; ok {
			out = append(out, n)
			if limit > 0 && len(out) >= limit {
				break
			}
		}
	}
	return out
}
