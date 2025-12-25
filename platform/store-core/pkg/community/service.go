package community

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CommunityService implements the gRPC CommunityService interface.
// Uses LeidenDetector for detection and CommunityStore for persistence.
type CommunityService struct {
	detector CommunityDetector
	store    CommunityStore
	labeler  CommunityLabeler // Optional LLM labeler
}

// NewCommunityService creates a new community service.
func NewCommunityService(store CommunityStore) *CommunityService {
	return &CommunityService{
		detector: NewLeidenDetector(DefaultLeidenConfig()),
		store:    store,
	}
}

// WithLabeler adds an LLM labeler for community naming.
func (s *CommunityService) WithLabeler(labeler CommunityLabeler) *CommunityService {
	s.labeler = labeler
	return s
}

// DetectCommunities runs Leiden community detection.
func (s *CommunityService) DetectCommunities(
	ctx context.Context,
	tenantID, projectID, datasetID string,
	config LeidenConfig,
	nodes []Node,
	edges []Edge,
) (*DetectionResult, error) {
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no nodes provided for community detection")
	}

	graph := Graph{
		Nodes: nodes,
		Edges: edges,
	}

	// Run Leiden
	result, err := s.detector.Detect(ctx, graph, config)
	if err != nil {
		return nil, fmt.Errorf("leiden detection failed: %w", err)
	}

	// Set tenant IDs
	for i := range result.Communities {
		result.Communities[i].TenantID = tenantID
	}

	// Persist communities
	for _, community := range result.Communities {
		if err := s.store.UpsertCommunity(ctx, community); err != nil {
			return nil, fmt.Errorf("failed to persist community %s: %w", community.ID, err)
		}
	}

	// Persist memberships
	for _, membership := range result.Memberships {
		if err := s.store.UpsertMembership(ctx, membership); err != nil {
			return nil, fmt.Errorf("failed to persist membership: %w", err)
		}
	}

	return &DetectionResult{
		TotalCommunities: len(result.Communities),
		NumLevels:        result.NumLevels,
		Modularity:       result.Modularity,
		ProcessingTime:   result.ProcessingTime,
		Communities:      result.Communities,
	}, nil
}

// DetectionResult contains the output of DetectCommunities.
type DetectionResult struct {
	TotalCommunities int
	NumLevels        int
	Modularity       float64
	ProcessingTime   time.Duration
	Communities      []Community
}

// ListCommunities returns communities matching filter criteria.
func (s *CommunityService) ListCommunities(
	ctx context.Context,
	filter CommunityFilter,
) ([]Community, int, error) {
	communities, err := s.store.ListCommunities(ctx, filter)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list communities: %w", err)
	}

	return communities, len(communities), nil
}

// GetCommunity retrieves a specific community by ID.
func (s *CommunityService) GetCommunity(
	ctx context.Context,
	tenantID, communityID string,
) (*Community, error) {
	community, err := s.store.GetCommunity(ctx, communityID)
	if err != nil {
		return nil, fmt.Errorf("failed to get community %s: %w", communityID, err)
	}
	if community == nil {
		return nil, fmt.Errorf("community not found: %s", communityID)
	}
	if community.TenantID != tenantID {
		return nil, fmt.Errorf("community not found: %s", communityID)
	}
	return community, nil
}

// GetCommunityMembers returns members of a community.
func (s *CommunityService) GetCommunityMembers(
	ctx context.Context,
	tenantID, communityID string,
	includeLeft bool,
	limit, offset int,
) ([]CommunityMember, int, error) {
	// P1 Fix: Validate tenant ownership first
	community, err := s.store.GetCommunity(ctx, communityID)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get community: %w", err)
	}
	if community == nil || community.TenantID != tenantID {
		return nil, 0, fmt.Errorf("community not found: %s", communityID)
	}

	members, err := s.store.GetCommunityMembers(ctx, communityID)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get members: %w", err)
	}

	// Filter out left members unless requested
	if !includeLeft {
		active := make([]CommunityMember, 0)
		for _, m := range members {
			if m.LeftAt == nil {
				active = append(active, m)
			}
		}
		members = active
	}

	total := len(members)

	// Apply pagination
	if offset >= len(members) {
		return []CommunityMember{}, total, nil
	}
	members = members[offset:]
	if limit > 0 && len(members) > limit {
		members = members[:limit]
	}

	return members, total, nil
}

// GetCommunityHierarchy returns the hierarchical structure.
func (s *CommunityService) GetCommunityHierarchy(
	ctx context.Context,
	tenantID, rootID string,
	maxDepth int,
) (*CommunityHierarchy, error) {
	// P1 Fix: Require rootID to ensure tenant-scoped hierarchy
	if rootID == "" {
		return nil, fmt.Errorf("rootID is required for tenant-scoped hierarchy")
	}

	// Validate tenant ownership of root community
	root, err := s.store.GetCommunity(ctx, rootID)
	if err != nil {
		return nil, fmt.Errorf("failed to get root community: %w", err)
	}
	if root == nil || root.TenantID != tenantID {
		return nil, fmt.Errorf("community not found: %s", rootID)
	}

	hierarchy, err := s.store.GetHierarchy(ctx, rootID)
	if err != nil {
		return nil, fmt.Errorf("failed to get hierarchy: %w", err)
	}

	// Apply depth limit if specified
	if maxDepth > 0 {
		hierarchy = pruneHierarchy(hierarchy, maxDepth, 0)
	}

	return hierarchy, nil
}

// pruneHierarchy limits hierarchy depth.
func pruneHierarchy(h *CommunityHierarchy, maxDepth, currentDepth int) *CommunityHierarchy {
	if h == nil || currentDepth >= maxDepth {
		if h != nil {
			h.Children = nil
		}
		return h
	}

	for i := range h.Children {
		h.Children[i] = *pruneHierarchy(&h.Children[i], maxDepth, currentDepth+1)
	}
	return h
}

// GetEntityCommunities returns communities an entity belongs to.
func (s *CommunityService) GetEntityCommunities(
	ctx context.Context,
	tenantID, entityID string,
	includeHistory bool,
) ([]Community, []CommunityMember, error) {
	allCommunities, err := s.store.GetEntityCommunities(ctx, entityID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get entity communities: %w", err)
	}

	// P1 Fix: Build aligned pairs from the start
	resultCommunities := make([]Community, 0, len(allCommunities))
	resultMemberships := make([]CommunityMember, 0, len(allCommunities))

	for _, c := range allCommunities {
		// P1 Fix: Validate tenant ownership
		if c.TenantID != tenantID {
			continue
		}

		members, err := s.store.GetCommunityMembers(ctx, c.ID)
		if err != nil {
			continue
		}

		for _, m := range members {
			if m.EntityID == entityID {
				// Check if we should include this membership
				isCurrent := m.LeftAt == nil
				if includeHistory || isCurrent {
					resultCommunities = append(resultCommunities, c)
					resultMemberships = append(resultMemberships, m)
				}
				break
			}
		}
	}

	return resultCommunities, resultMemberships, nil
}

// LabelCommunities generates labels for unlabeled communities using LLM.
func (s *CommunityService) LabelCommunities(ctx context.Context, tenantID string) error {
	if s.labeler == nil {
		return fmt.Errorf("no labeler configured")
	}

	// Get unlabeled communities
	communities, err := s.store.ListCommunities(ctx, CommunityFilter{
		TenantID: tenantID,
		Limit:    100,
	})
	if err != nil {
		return err
	}

	for _, c := range communities {
		if c.Label != "" {
			continue // Already labeled
		}

		// Get member summaries for context
		members, err := s.store.GetCommunityMembers(ctx, c.ID)
		if err != nil {
			continue
		}

		summaries := make([]string, 0, len(members))
		for _, m := range members {
			summaries = append(summaries, m.EntityID)
		}

		// Generate label
		label, description, keywords, err := s.labeler.LabelCommunity(ctx, c, summaries)
		if err != nil {
			continue
		}

		// Update community
		c.Label = label
		c.Description = description
		c.Keywords = keywords
		if err := s.store.UpsertCommunity(ctx, c); err != nil {
			continue
		}
	}

	return nil
}

// ===== Proto Conversion Helpers =====

// CommunityToProto converts Community to proto format.
func CommunityToProto(c Community) *CommunityProto {
	return &CommunityProto{
		ID:          c.ID,
		TenantID:    c.TenantID,
		Level:       CommunityLevelToProto(c.Level),
		ParentID:    c.ParentID,
		Label:       c.Label,
		Description: c.Description,
		Size:        int32(c.Size),
		Modularity:  c.Modularity,
		Keywords:    c.Keywords,
		Temporal:    TemporalToProto(c.Temporal),
		Centroid:    c.Centroid,
	}
}

// CommunityProto is the proto representation (placeholder for generated type).
type CommunityProto struct {
	ID          string
	TenantID    string
	Level       int32
	ParentID    string
	Label       string
	Description string
	Size        int32
	Modularity  float64
	Keywords    []string
	Temporal    *CommunityTemporalProto
	Centroid    []float32
}

// CommunityTemporalProto is the proto representation of temporal metadata.
type CommunityTemporalProto struct {
	FirstSeen     *timestamppb.Timestamp
	LastSeen      *timestamppb.Timestamp
	LastActivity  *timestamppb.Timestamp
	ActivityCount int32
	Stability     float64
}

// CommunityLevelToProto converts CommunityLevel to proto enum.
func CommunityLevelToProto(l CommunityLevel) int32 {
	return int32(l) + 1 // Proto enum starts at 1 (0 is UNSPECIFIED)
}

// TemporalToProto converts CommunityTemporalMeta to proto.
func TemporalToProto(t CommunityTemporalMeta) *CommunityTemporalProto {
	return &CommunityTemporalProto{
		FirstSeen:     timestamppb.New(t.FirstSeen),
		LastSeen:      timestamppb.New(t.LastSeen),
		LastActivity:  timestamppb.New(t.LastActivity),
		ActivityCount: int32(t.ActivityCount),
		Stability:     t.Stability,
	}
}

// DetectionResultToProto converts DetectionResult to proto response.
func DetectionResultToProto(r *DetectionResult) *DetectionResultProto {
	communities := make([]*CommunityProto, 0, len(r.Communities))
	for _, c := range r.Communities {
		if c.Level == LevelTopic { // Only top-level
			communities = append(communities, CommunityToProto(c))
		}
	}

	// P2 Fix: Count only top-level communities returned in response
	return &DetectionResultProto{
		TotalCommunities: int32(len(communities)),
		NumLevels:        int32(r.NumLevels),
		Modularity:       r.Modularity,
		ProcessingTime:   durationpb.New(r.ProcessingTime),
		Communities:      communities,
	}
}

// DetectionResultProto is the proto representation.
type DetectionResultProto struct {
	TotalCommunities int32
	NumLevels        int32
	Modularity       float64
	ProcessingTime   *durationpb.Duration
	Communities      []*CommunityProto
}
