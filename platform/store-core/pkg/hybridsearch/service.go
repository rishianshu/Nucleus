// Package hybridsearch provides the gRPC service implementation for hybrid search.
package hybridsearch

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SearchService implements the gRPC SearchService.
type SearchService struct {
	searcher *Searcher
	db       *sql.DB
}

// NewSearchService creates a new SearchService.
func NewSearchService(db *sql.DB, vectorTable, ftsView string, opts Options) *SearchService {
	return &SearchService{
		searcher: New(db, vectorTable, ftsView, opts),
		db:       db,
	}
}

// HybridSearchRequest represents the incoming request.
type HybridSearchRequest struct {
	Query          string
	Embedding      []float32
	TenantID       string
	ProjectID      string
	ProfileIDs     []string
	SourceFamilies []string
	EntityKinds    []string
	DatasetSlugs   []string
	Temporal       *TemporalFilterRequest
	Limit          int32
	VectorWeight   float32
	KeywordWeight  float32
}

// TemporalFilterRequest represents temporal filter from request.
type TemporalFilterRequest struct {
	LastActivityAfter  *time.Time
	LastActivityBefore *time.Time
	FirstSeenAfter     *time.Time
	FirstSeenBefore    *time.Time
	AsOf               *time.Time
}

// HybridSearchResponse represents the response.
type HybridSearchResponse struct {
	Results       []SearchResult
	TotalCount    int32
	VectorTimeMs  float32
	KeywordTimeMs float32
	FusionTimeMs  float32
}

// SearchResult represents a single search result.
type SearchResult struct {
	NodeID       string
	ProfileID    string
	Score        float32
	VectorScore  float32
	KeywordScore float32
	VectorRank   int32
	KeywordRank  int32
	ContentText  string
	Metadata     map[string]string
	EntityKind   string
	SourceFamily string
}

// HybridSearch performs combined vector + keyword search with RRF fusion.
func (s *SearchService) HybridSearch(ctx context.Context, req *HybridSearchRequest) (*HybridSearchResponse, error) {
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}
	if req.Query == "" && len(req.Embedding) == 0 {
		return nil, status.Error(codes.InvalidArgument, "query or embedding is required")
	}

	// Convert request to internal Query
	q := Query{
		Text:           req.Query,
		Embedding:      req.Embedding,
		TenantID:       req.TenantID,
		ProjectID:      req.ProjectID,
		ProfileIDs:     req.ProfileIDs,
		SourceFamilies: req.SourceFamilies,
		EntityKinds:    req.EntityKinds,
		DatasetSlugs:   req.DatasetSlugs,
		Limit:          int(req.Limit),
	}

	// Convert temporal filter
	var tf *TemporalFilter
	if req.Temporal != nil {
		tf = &TemporalFilter{
			LastActivityAfter:  req.Temporal.LastActivityAfter,
			LastActivityBefore: req.Temporal.LastActivityBefore,
			FirstSeenAfter:     req.Temporal.FirstSeenAfter,
			FirstSeenBefore:    req.Temporal.FirstSeenBefore,
			AsOf:               req.Temporal.AsOf,
		}
	}

	// Temporarily override weights if provided
	if req.VectorWeight > 0 || req.KeywordWeight > 0 {
		// Create new searcher with custom weights
		opts := s.searcher.opts
		if req.VectorWeight > 0 {
			opts.VectorWeight = req.VectorWeight
		}
		if req.KeywordWeight > 0 {
			opts.KeywordWeight = req.KeywordWeight
		}
		tempSearcher := New(s.db, s.searcher.table, s.searcher.ftsView, opts)
		results, err := tempSearcher.Search(ctx, q, tf)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "search failed: %v", err)
		}
		return s.toResponse(results), nil
	}

	results, err := s.searcher.Search(ctx, q, tf)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "search failed: %v", err)
	}

	return s.toResponse(results), nil
}

func (s *SearchService) toResponse(results []Result) *HybridSearchResponse {
	resp := &HybridSearchResponse{
		Results:    make([]SearchResult, len(results)),
		TotalCount: int32(len(results)),
	}

	for i, r := range results {
		resp.Results[i] = SearchResult{
			NodeID:       r.NodeID,
			ProfileID:    r.ProfileID,
			Score:        r.Score,
			VectorScore:  r.VectorScore,
			KeywordScore: r.KeywordScore,
			VectorRank:   int32(r.VectorRank),
			KeywordRank:  int32(r.KeywordRank),
			ContentText:  r.ContentText,
			Metadata:     toStringMap(r.Metadata),
		}
	}

	return resp
}

func toStringMap(m map[string]any) map[string]string {
	if m == nil {
		return nil
	}
	result := make(map[string]string, len(m))
	for k, v := range m {
		result[k] = fmt.Sprintf("%v", v)
	}
	return result
}

// NearbyRequest represents a nearby search request.
type NearbyRequest struct {
	EntityID      string
	TenantID      string
	ProjectID     string
	Limit         int32
	MinSimilarity float32
	Temporal      *TemporalFilterRequest
}

// NearbyResponse represents nearby search results.
type NearbyResponse struct {
	Results []SearchResult
}

// NearbyEntities finds entities similar to a given entity.
func (s *SearchService) NearbyEntities(ctx context.Context, req *NearbyRequest) (*NearbyResponse, error) {
	if req.EntityID == "" {
		return nil, status.Error(codes.InvalidArgument, "entity_id is required")
	}
	if req.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id is required")
	}

	// Fetch the entity's embedding
	var embedding []float32
	var embBytes []byte
	err := s.db.QueryRowContext(ctx,
		fmt.Sprintf("SELECT embedding FROM %s WHERE node_id = $1 AND tenant_id = $2 LIMIT 1", s.searcher.table),
		req.EntityID, req.TenantID,
	).Scan(&embBytes)
	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "entity not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to fetch entity: %v", err)
	}

	// Parse embedding from bytes (format: [1.0,2.0,...])
	embedding = parseEmbedding(string(embBytes))
	if len(embedding) == 0 {
		return nil, status.Error(codes.Internal, "entity has no embedding")
	}

	// Search for similar entities
	q := Query{
		Embedding: embedding,
		TenantID:  req.TenantID,
		ProjectID: req.ProjectID,
		Limit:     int(req.Limit),
	}

	var tf *TemporalFilter
	if req.Temporal != nil {
		tf = &TemporalFilter{
			LastActivityAfter:  req.Temporal.LastActivityAfter,
			LastActivityBefore: req.Temporal.LastActivityBefore,
			FirstSeenAfter:     req.Temporal.FirstSeenAfter,
			FirstSeenBefore:    req.Temporal.FirstSeenBefore,
			AsOf:               req.Temporal.AsOf,
		}
	}

	results, err := s.searcher.Search(ctx, q, tf)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "search failed: %v", err)
	}

	// Filter out the source entity and apply min similarity
	filtered := make([]SearchResult, 0, len(results))
	for _, r := range results {
		if r.NodeID == req.EntityID {
			continue
		}
		if req.MinSimilarity > 0 && r.VectorScore < req.MinSimilarity {
			continue
		}
		filtered = append(filtered, SearchResult{
			NodeID:       r.NodeID,
			ProfileID:    r.ProfileID,
			Score:        r.Score,
			VectorScore:  r.VectorScore,
			KeywordScore: r.KeywordScore,
			VectorRank:   int32(r.VectorRank),
			KeywordRank:  int32(r.KeywordRank),
			ContentText:  r.ContentText,
			Metadata:     toStringMap(r.Metadata),
		})
	}

	return &NearbyResponse{Results: filtered}, nil
}

// parseEmbedding parses an embedding from PostgreSQL vector format.
func parseEmbedding(s string) []float32 {
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]float32, 0, len(parts))
	for _, p := range parts {
		var f float64
		if _, err := fmt.Sscanf(strings.TrimSpace(p), "%f", &f); err == nil {
			result = append(result, float32(f))
		}
	}
	return result
}

// TimestampToTime converts protobuf timestamp to Go time.
func TimestampToTime(ts *timestamppb.Timestamp) *time.Time {
	if ts == nil {
		return nil
	}
	t := ts.AsTime()
	return &t
}
