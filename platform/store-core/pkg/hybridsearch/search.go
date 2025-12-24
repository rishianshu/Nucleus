// Package hybridsearch provides hybrid vector + keyword search with RRF fusion.
package hybridsearch

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Result represents a search result with combined score.
type Result struct {
	NodeID       string
	ProfileID    string
	Score        float32   // Combined RRF score
	VectorScore  float32   // Vector similarity score
	KeywordScore float32   // FTS relevance score
	VectorRank   int       // Rank from vector search
	KeywordRank  int       // Rank from keyword search
	ContentText  string
	Metadata     map[string]any
}

// Query represents a hybrid search query.
type Query struct {
	Text           string   // Query text (for FTS)
	Embedding      []float32 // Query embedding (for vector search)
	TenantID       string
	ProjectID      string
	ProfileIDs     []string
	SourceFamilies []string
	EntityKinds    []string
	DatasetSlugs   []string
	Limit          int
}

// TemporalFilter provides time-based filtering.
type TemporalFilter struct {
	LastActivityAfter  *time.Time
	LastActivityBefore *time.Time
	FirstSeenAfter     *time.Time
	FirstSeenBefore    *time.Time
	AsOf               *time.Time // Point-in-time snapshot
}

// Options configures the hybrid search behavior.
type Options struct {
	VectorWeight  float32 // Weight for vector results (default: 0.5)
	KeywordWeight float32 // Weight for keyword results (default: 0.5)
	VectorK       int     // RRF constant for vector (default: 60)
	KeywordK      int     // RRF constant for keyword (default: 60)
	MaxResults    int     // Max results to return (default: 100)
}

// DefaultOptions returns sensible defaults for hybrid search.
func DefaultOptions() Options {
	return Options{
		VectorWeight:  0.5,
		KeywordWeight: 0.5,
		VectorK:       60,
		KeywordK:      60,
		MaxResults:    100,
	}
}

// Searcher provides hybrid search over vector and keyword indexes.
type Searcher struct {
	db      *sql.DB
	opts    Options
	table   string // Vector table name
	ftsView string // FTS view/table name
}

// New creates a new hybrid searcher.
func New(db *sql.DB, vectorTable, ftsView string, opts Options) *Searcher {
	// Apply defaults for zero-valued options
	if opts.VectorWeight == 0 {
		opts.VectorWeight = 0.5
	}
	if opts.KeywordWeight == 0 {
		opts.KeywordWeight = 0.5
	}
	if opts.VectorK == 0 {
		opts.VectorK = 60
	}
	if opts.KeywordK == 0 {
		opts.KeywordK = 60
	}
	if opts.MaxResults == 0 {
		opts.MaxResults = 100
	}
	return &Searcher{
		db:      db,
		opts:    opts,
		table:   vectorTable,
		ftsView: ftsView,
	}
}

// Search performs hybrid search using RRF (Reciprocal Rank Fusion).
func (s *Searcher) Search(ctx context.Context, q Query, tf *TemporalFilter) ([]Result, error) {
	// Get vector results
	vectorResults, err := s.vectorSearch(ctx, q, tf)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
	}

	// Get keyword results
	keywordResults, err := s.keywordSearch(ctx, q, tf)
	if err != nil {
		return nil, fmt.Errorf("keyword search: %w", err)
	}

	// Fuse results using RRF
	fused := s.rrfFusion(vectorResults, keywordResults)

	// Limit results - enforce MaxResults as absolute cap
	limit := s.opts.MaxResults
	if q.Limit > 0 && q.Limit < s.opts.MaxResults {
		limit = q.Limit // Use caller's limit if smaller than max
	}
	if len(fused) > limit {
		fused = fused[:limit]
	}

	return fused, nil
}

// vectorSearch performs vector similarity search.
func (s *Searcher) vectorSearch(ctx context.Context, q Query, tf *TemporalFilter) ([]Result, error) {
	if len(q.Embedding) == 0 {
		return nil, nil
	}

	// Build embedding array string
	embStr := make([]string, len(q.Embedding))
	for i, v := range q.Embedding {
		embStr[i] = fmt.Sprintf("%f", v)
	}
	embArray := "[" + strings.Join(embStr, ",") + "]"

	sql := fmt.Sprintf(`
		SELECT node_id, profile_id, content_text, 
		       1 - (embedding <=> $1::vector) as score,
		       metadata
		FROM %s
		WHERE tenant_id = $2
	`, s.table)

	args := []any{embArray, q.TenantID}
	argIdx := 3

	if q.ProjectID != "" {
		sql += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, q.ProjectID)
		argIdx++
	}

	if len(q.ProfileIDs) > 0 {
		sql += fmt.Sprintf(" AND profile_id = ANY($%d)", argIdx)
		args = append(args, q.ProfileIDs)
		argIdx++
	}

	if len(q.SourceFamilies) > 0 {
		sql += fmt.Sprintf(" AND source_family = ANY($%d)", argIdx)
		args = append(args, q.SourceFamilies)
		argIdx++
	}

	if len(q.EntityKinds) > 0 {
		sql += fmt.Sprintf(" AND entity_kind = ANY($%d)", argIdx)
		args = append(args, q.EntityKinds)
		argIdx++
	}

	// P2 Fix: Add dataset filter to vector search
	if len(q.DatasetSlugs) > 0 {
		sql += fmt.Sprintf(" AND dataset_slug = ANY($%d)", argIdx)
		args = append(args, q.DatasetSlugs)
		argIdx++
	}

	// Temporal filters (P2 Fix: include all temporal fields)
	if tf != nil {
		if tf.LastActivityAfter != nil {
			sql += fmt.Sprintf(" AND last_activity_at > $%d", argIdx)
			args = append(args, tf.LastActivityAfter)
			argIdx++
		}
		if tf.LastActivityBefore != nil {
			sql += fmt.Sprintf(" AND last_activity_at < $%d", argIdx)
			args = append(args, tf.LastActivityBefore)
			argIdx++
		}
		if tf.FirstSeenAfter != nil {
			sql += fmt.Sprintf(" AND first_seen_at > $%d", argIdx)
			args = append(args, tf.FirstSeenAfter)
			argIdx++
		}
		if tf.FirstSeenBefore != nil {
			sql += fmt.Sprintf(" AND first_seen_at < $%d", argIdx)
			args = append(args, tf.FirstSeenBefore)
			argIdx++
		}
		// AsOf is used for point-in-time queries - filter records that existed at that time
		if tf.AsOf != nil {
			sql += fmt.Sprintf(" AND first_seen_at <= $%d", argIdx)
			args = append(args, tf.AsOf)
			argIdx++
		}
	}

	sql += fmt.Sprintf(" ORDER BY embedding <=> $1::vector LIMIT %d", s.opts.MaxResults)

	rows, err := s.db.QueryContext(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Result
	rank := 0
	for rows.Next() {
		rank++
		var r Result
		var metadata []byte
		if err := rows.Scan(&r.NodeID, &r.ProfileID, &r.ContentText, &r.VectorScore, &metadata); err != nil {
			return nil, err
		}
		// P2 Fix: Populate metadata from JSON bytes
		if len(metadata) > 0 {
			if err := json.Unmarshal(metadata, &r.Metadata); err != nil {
				// Log but don't fail on malformed metadata
				r.Metadata = map[string]any{"_raw": string(metadata)}
			}
		}
		r.VectorRank = rank
		results = append(results, r)
	}
	return results, rows.Err()
}

// keywordSearch performs full-text search using PostgreSQL tsvector.
func (s *Searcher) keywordSearch(ctx context.Context, q Query, tf *TemporalFilter) ([]Result, error) {
	if strings.TrimSpace(q.Text) == "" {
		return nil, nil
	}

	sql := fmt.Sprintf(`
		SELECT node_id, profile_id, content_text,
		       ts_rank_cd(tsv, plainto_tsquery($1)) as score
		FROM %s
		WHERE tsv @@ plainto_tsquery($1)
		  AND tenant_id = $2
	`, s.ftsView)

	args := []any{q.Text, q.TenantID}
	argIdx := 3

	if q.ProjectID != "" {
		sql += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, q.ProjectID)
		argIdx++
	}

	if len(q.SourceFamilies) > 0 {
		sql += fmt.Sprintf(" AND source_family = ANY($%d)", argIdx)
		args = append(args, q.SourceFamilies)
		argIdx++
	}

	// P1 Fix: Add profile and dataset filters to keyword search
	if len(q.ProfileIDs) > 0 {
		sql += fmt.Sprintf(" AND profile_id = ANY($%d)", argIdx)
		args = append(args, q.ProfileIDs)
		argIdx++
	}

	if len(q.DatasetSlugs) > 0 {
		sql += fmt.Sprintf(" AND dataset_slug = ANY($%d)", argIdx)
		args = append(args, q.DatasetSlugs)
		argIdx++
	}

	if len(q.EntityKinds) > 0 {
		sql += fmt.Sprintf(" AND entity_kind = ANY($%d)", argIdx)
		args = append(args, q.EntityKinds)
		argIdx++
	}

	// Temporal filters (P2 Fix: include all temporal fields)
	if tf != nil {
		if tf.LastActivityAfter != nil {
			sql += fmt.Sprintf(" AND last_activity_at > $%d", argIdx)
			args = append(args, tf.LastActivityAfter)
			argIdx++
		}
		if tf.LastActivityBefore != nil {
			sql += fmt.Sprintf(" AND last_activity_at < $%d", argIdx)
			args = append(args, tf.LastActivityBefore)
			argIdx++
		}
		if tf.FirstSeenAfter != nil {
			sql += fmt.Sprintf(" AND first_seen_at > $%d", argIdx)
			args = append(args, tf.FirstSeenAfter)
			argIdx++
		}
		if tf.FirstSeenBefore != nil {
			sql += fmt.Sprintf(" AND first_seen_at < $%d", argIdx)
			args = append(args, tf.FirstSeenBefore)
			argIdx++
		}
		if tf.AsOf != nil {
			sql += fmt.Sprintf(" AND first_seen_at <= $%d", argIdx)
			args = append(args, tf.AsOf)
			argIdx++
		}
	}

	sql += fmt.Sprintf(" ORDER BY ts_rank_cd(tsv, plainto_tsquery($1)) DESC LIMIT %d", s.opts.MaxResults)

	rows, err := s.db.QueryContext(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Result
	rank := 0
	for rows.Next() {
		rank++
		var r Result
		if err := rows.Scan(&r.NodeID, &r.ProfileID, &r.ContentText, &r.KeywordScore); err != nil {
			return nil, err
		}
		r.KeywordRank = rank
		results = append(results, r)
	}
	return results, rows.Err()
}

// rrfFusion combines vector and keyword results using Reciprocal Rank Fusion.
// RRF score = weight * (1 / (k + rank))
func (s *Searcher) rrfFusion(vectorResults, keywordResults []Result) []Result {
	// Build map of all results
	resultMap := make(map[string]*Result)

	// Add vector results
	for _, r := range vectorResults {
		nr := r
		nr.Score = s.opts.VectorWeight * (1.0 / float32(s.opts.VectorK+r.VectorRank))
		resultMap[r.NodeID] = &nr
	}

	// Add keyword results
	for _, r := range keywordResults {
		if existing, ok := resultMap[r.NodeID]; ok {
			// Combine scores
			existing.Score += s.opts.KeywordWeight * (1.0 / float32(s.opts.KeywordK+r.KeywordRank))
			existing.KeywordScore = r.KeywordScore
			existing.KeywordRank = r.KeywordRank
		} else {
			nr := r
			nr.Score = s.opts.KeywordWeight * (1.0 / float32(s.opts.KeywordK+r.KeywordRank))
			resultMap[r.NodeID] = &nr
		}
	}

	// Convert to slice and sort by score
	results := make([]Result, 0, len(resultMap))
	for _, r := range resultMap {
		results = append(results, *r)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}

// Close releases resources.
func (s *Searcher) Close() error {
	return nil
}
