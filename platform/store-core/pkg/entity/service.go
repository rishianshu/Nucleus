package entity

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ===================================================
// Entity Registry Service
// gRPC service for entity resolution and management
// ===================================================

// Service handles entity registry gRPC operations.
type Service struct {
	registry EntityRegistry
	matcher  EntityMatcher
}

// NewService creates a new entity service.
func NewService(registry EntityRegistry, matcher EntityMatcher) *Service {
	return &Service{
		registry: registry,
		matcher:  matcher,
	}
}

// ===================================================
// Request/Response Types (proto-like)
// ===================================================

// ResolveEntityRequest for entity resolution.
type ResolveEntityRequest struct {
	TenantID   string            `json:"tenantId"`
	Source     string            `json:"source"`
	ExternalID string            `json:"externalId"`
	Type       string            `json:"type"`
	Name       string            `json:"name"`
	Email      string            `json:"email"`
	Aliases    []string          `json:"aliases"`
	Qualifiers map[string]string `json:"qualifiers"`
	Properties map[string]any    `json:"properties"`
	URL        string            `json:"url"`
	NodeID     string            `json:"nodeId"`
}

// ResolveEntityResponse for entity resolution.
type ResolveEntityResponse struct {
	Entity    *CanonicalEntity `json:"entity"`
	Created   bool             `json:"created"`   // True if new entity was created
	MatchedBy string           `json:"matchedBy"` // Rule that matched (if not created)
}

// GetEntityRequest for retrieving an entity.
type GetEntityRequest struct {
	TenantID string `json:"tenantId"`
	ID       string `json:"id"`
}

// GetEntityResponse for entity retrieval.
type GetEntityResponse struct {
	Entity *CanonicalEntity `json:"entity"`
}

// FindMatchesRequest for finding potential matches.
type FindMatchesRequest struct {
	TenantID   string            `json:"tenantId"`
	Source     string            `json:"source"`
	ExternalID string            `json:"externalId"`
	Type       string            `json:"type"`
	Name       string            `json:"name"`
	Email      string            `json:"email"`
	Qualifiers map[string]string `json:"qualifiers"`
}

// FindMatchesResponse for match results.
type FindMatchesResponse struct {
	Matches []MatchResult `json:"matches"`
}

// MergeEntitiesRequest for merging entities.
type MergeEntitiesRequest struct {
	TenantID   string `json:"tenantId"`
	SurvivorID string `json:"survivorId"`
	MergedID   string `json:"mergedId"`
}

// MergeEntitiesResponse for merge result.
type MergeEntitiesResponse struct {
	Entity *CanonicalEntity `json:"entity"`
}

// AddAliasRequest for adding an alias.
type AddAliasRequest struct {
	TenantID string `json:"tenantId"`
	ID       string `json:"id"`
	Alias    string `json:"alias"`
}

// P1 Fix: Add GetBySourceRef request type
type GetBySourceRefRequest struct {
	TenantID   string `json:"tenantId"`
	Source     string `json:"source"`
	ExternalID string `json:"externalId"`
}

// P1 Fix: Add AddSourceRef request type
type AddSourceRefRequest struct {
	TenantID  string    `json:"tenantId"`
	ID        string    `json:"id"`
	SourceRef SourceRef `json:"sourceRef"`
}

// ListEntitiesRequest for listing entities with temporal support.
type ListEntitiesRequest struct {
	TenantID           string            `json:"tenantId"`
	Types              []string          `json:"types"`
	NameLike           string            `json:"nameLike"`
	Qualifiers         map[string]string `json:"qualifiers"`
	Source             string            `json:"source"`
	// Temporal filters
	UpdatedAfter       *time.Time        `json:"updatedAfter"`
	FirstSeenAfter     *time.Time        `json:"firstSeenAfter"`
	FirstSeenBefore    *time.Time        `json:"firstSeenBefore"`
	LastActivityAfter  *time.Time        `json:"lastActivityAfter"`
	LastActivityBefore *time.Time        `json:"lastActivityBefore"`
	MinActivityCount   int               `json:"minActivityCount"`
	// P2 Fix: Add missing temporal filter fields
	MinMentionCount    int               `json:"minMentionCount"`
	MinVelocity        float64           `json:"minVelocity"`
	AsOf               *time.Time        `json:"asOf"`
	Limit              int               `json:"limit"`
	Offset             int               `json:"offset"`
}

// ListEntitiesResponse for entity list.
type ListEntitiesResponse struct {
	Entities []*CanonicalEntity `json:"entities"`
	Total    int                `json:"total"`
}

// ResolveBatchRequest for batch entity resolution.
type ResolveBatchRequest struct {
	TenantID string         `json:"tenantId"`
	Sources  []SourceEntity `json:"sources"`
}

// ResolveBatchResponse for batch results.
type ResolveBatchResponse struct {
	Results       map[string]*CanonicalEntity `json:"results"`       // source:externalId -> entity
	ResolvedCount int                         `json:"resolvedCount"` // Matched existing
	CreatedCount  int                         `json:"createdCount"`  // Created new
	Errors        map[string]string           `json:"errors"`        // source:externalId -> error
}

// ===================================================
// Service Methods
// ===================================================

// ResolveEntity resolves a source entity to a canonical entity.
func (s *Service) ResolveEntity(ctx context.Context, req *ResolveEntityRequest) (*ResolveEntityResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.Source == "" {
		return nil, status.Error(codes.InvalidArgument, "source is required")
	}
	if req.ExternalID == "" {
		return nil, status.Error(codes.InvalidArgument, "external_id is required")
	}

	source := SourceEntity{
		Source:     req.Source,
		ExternalID: req.ExternalID,
		Type:       req.Type,
		Name:       req.Name,
		Email:      req.Email,
		Aliases:    req.Aliases,
		Qualifiers: req.Qualifiers,
		Properties: req.Properties,
		URL:        req.URL,
		NodeID:     req.NodeID,
	}

	entity, created, err := s.matcher.ResolveOrCreate(ctx, req.TenantID, source)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve entity: %v", err)
	}

	resp := &ResolveEntityResponse{
		Entity:  entity,
		Created: created,
	}

	if !created {
		// Find the rule that matched
		matches, _ := s.matcher.FindMatches(ctx, req.TenantID, source)
		if len(matches) > 0 {
			resp.MatchedBy = matches[0].MatchedBy
		}
	}

	return resp, nil
}

// GetEntity retrieves an entity by ID.
func (s *Service) GetEntity(ctx context.Context, req *GetEntityRequest) (*GetEntityResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.ID == "" {
		return nil, status.Error(codes.InvalidArgument, "id is required")
	}

	entity, err := s.registry.Get(ctx, req.TenantID, req.ID)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "entity not found: %v", err)
	}

	return &GetEntityResponse{Entity: entity}, nil
}

// FindMatches finds potential canonical entity matches.
func (s *Service) FindMatches(ctx context.Context, req *FindMatchesRequest) (*FindMatchesResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}

	source := SourceEntity{
		Source:     req.Source,
		ExternalID: req.ExternalID,
		Type:       req.Type,
		Name:       req.Name,
		Email:      req.Email,
		Qualifiers: req.Qualifiers,
	}

	matches, err := s.matcher.FindMatches(ctx, req.TenantID, source)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to find matches: %v", err)
	}

	return &FindMatchesResponse{Matches: matches}, nil
}

// MergeEntities merges two entities.
func (s *Service) MergeEntities(ctx context.Context, req *MergeEntitiesRequest) (*MergeEntitiesResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.SurvivorID == "" || req.MergedID == "" {
		return nil, status.Error(codes.InvalidArgument, "survivor_id and merged_id are required")
	}
	if req.SurvivorID == req.MergedID {
		return nil, status.Error(codes.InvalidArgument, "cannot merge entity with itself")
	}

	entity, err := s.registry.Merge(ctx, req.TenantID, req.SurvivorID, req.MergedID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to merge entities: %v", err)
	}

	return &MergeEntitiesResponse{Entity: entity}, nil
}

// AddAlias adds an alias to an entity.
func (s *Service) AddAlias(ctx context.Context, req *AddAliasRequest) error {
	if req.TenantID == "" {
		return status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.ID == "" {
		return status.Error(codes.InvalidArgument, "id is required")
	}
	if req.Alias == "" {
		return status.Error(codes.InvalidArgument, "alias is required")
	}

	if err := s.registry.AddAlias(ctx, req.TenantID, req.ID, req.Alias); err != nil {
		return status.Errorf(codes.Internal, "failed to add alias: %v", err)
	}

	return nil
}

// P1 Fix: GetBySourceRef retrieves an entity by source reference.
func (s *Service) GetBySourceRef(ctx context.Context, req *GetBySourceRefRequest) (*GetEntityResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.Source == "" {
		return nil, status.Error(codes.InvalidArgument, "source is required")
	}
	if req.ExternalID == "" {
		return nil, status.Error(codes.InvalidArgument, "external_id is required")
	}

	entity, err := s.registry.GetBySourceRef(ctx, req.TenantID, req.Source, req.ExternalID)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "entity not found: %v", err)
	}

	return &GetEntityResponse{Entity: entity}, nil
}

// P1 Fix: AddSourceRef links a source entity to a canonical entity.
func (s *Service) AddSourceRef(ctx context.Context, req *AddSourceRefRequest) error {
	if req.TenantID == "" {
		return status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.ID == "" {
		return status.Error(codes.InvalidArgument, "id is required")
	}
	if req.SourceRef.Source == "" {
		return status.Error(codes.InvalidArgument, "source_ref.source is required")
	}
	if req.SourceRef.ExternalID == "" {
		return status.Error(codes.InvalidArgument, "source_ref.external_id is required")
	}

	if err := s.registry.AddSourceRef(ctx, req.TenantID, req.ID, req.SourceRef); err != nil {
		return status.Errorf(codes.Internal, "failed to add source ref: %v", err)
	}

	return nil
}

func (s *Service) ListEntities(ctx context.Context, req *ListEntitiesRequest) (*ListEntitiesResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	filter := EntityFilter{
		Types:              req.Types,
		NameLike:           req.NameLike,
		Qualifiers:         req.Qualifiers,
		Source:             req.Source,
		UpdatedAfter:       req.UpdatedAfter,
		FirstSeenAfter:     req.FirstSeenAfter,
		FirstSeenBefore:    req.FirstSeenBefore,
		LastActivityAfter:  req.LastActivityAfter,
		LastActivityBefore: req.LastActivityBefore,
		MinActivityCount:   req.MinActivityCount,
		// P2 Fix: Pass through missing temporal fields
		MinMentionCount:    req.MinMentionCount,
		MinVelocity:        req.MinVelocity,
		AsOf:               req.AsOf,
	}

	entities, err := s.registry.List(ctx, req.TenantID, filter, limit, req.Offset)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list entities: %v", err)
	}

	return &ListEntitiesResponse{
		Entities: entities,
		Total:    len(entities), // Would ideally be a count query
	}, nil
}

// ===================================================
// Batch Operations
// ===================================================

// ResolveBatch resolves multiple source entities at once.
// P1 Fix: Updated to match proto signature with counters and error reporting.
func (s *Service) ResolveBatch(ctx context.Context, req *ResolveBatchRequest) (*ResolveBatchResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}

	results := make(map[string]*CanonicalEntity)
	errors := make(map[string]string)
	resolvedCount := 0
	createdCount := 0

	for _, source := range req.Sources {
		key := fmt.Sprintf("%s:%s", source.Source, source.ExternalID)
		entity, created, err := s.matcher.ResolveOrCreate(ctx, req.TenantID, source)
		if err != nil {
			errors[key] = err.Error()
			continue
		}
		results[key] = entity
		if created {
			createdCount++
		} else {
			resolvedCount++
		}
	}

	return &ResolveBatchResponse{
		Results:       results,
		ResolvedCount: resolvedCount,
		CreatedCount:  createdCount,
		Errors:        errors,
	}, nil
}
