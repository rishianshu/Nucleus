package graphrag

import (
	"context"
	"fmt"

	"github.com/nucleus/store-core/pkg/hybridsearch"
)

// ===================================================
// Hybrid Search Adapter
// Connects hybridsearch.Searcher to GraphRAG's HybridSearcher interface
// ===================================================

// HybridSearchAdapter adapts hybridsearch.Searcher to the HybridSearcher interface.
// This integrates the existing vector + FTS + RRF fusion search with GraphRAG.
type HybridSearchAdapter struct {
	searcher *hybridsearch.Searcher
}

// NewHybridSearchAdapter creates a new adapter wrapping the hybridsearch.Searcher.
func NewHybridSearchAdapter(searcher *hybridsearch.Searcher) *HybridSearchAdapter {
	return &HybridSearchAdapter{
		searcher: searcher,
	}
}

// Search performs hybrid search and converts results to EntityMatch.
func (a *HybridSearchAdapter) Search(
	ctx context.Context,
	tenantID, query string,
	embedding []float32,
	config HybridSearchConfig,
) ([]EntityMatch, error) {
	if a.searcher == nil {
		return nil, nil
	}

	// Build hybridsearch.Query
	q := hybridsearch.Query{
		Text:       query,
		Embedding:  embedding,
		TenantID:   tenantID,
		ProjectID:  config.ProjectID,
		ProfileIDs: config.ProfileIDs,
		EntityKinds: config.EntityKinds,
		Limit:      config.TopK,
	}

	// Perform search
	results, err := a.searcher.Search(ctx, q, nil)
	if err != nil {
		return nil, err
	}

	// Convert to EntityMatch
	matches := make([]EntityMatch, 0, len(results))
	for _, r := range results {
		// Filter by min score if specified
		if config.MinScore > 0 && r.Score < config.MinScore {
			continue
		}
		
		matches = append(matches, EntityMatch{
			ID:          r.NodeID,
			Score:       r.Score,
			Type:        getMetadataString(r.Metadata, "entity_kind", ""),
			Name:        getMetadataString(r.Metadata, "name", r.NodeID),
			Content:     r.ContentText, // P2 Fix: Use Content for ToPromptContext
			Description: r.ContentText,
			ProfileID:   r.ProfileID,
			Metadata:    convertMetadata(r.Metadata),
		})
	}

	return matches, nil
}

// getMetadataString extracts a string value from metadata.
func getMetadataString(m map[string]any, key, defaultVal string) string {
	if m == nil {
		return defaultVal
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return defaultVal
}

// convertMetadata converts map[string]any to map[string]string.
func convertMetadata(m map[string]any) map[string]string {
	if m == nil {
		return nil
	}
	result := make(map[string]string, len(m))
	for k, v := range m {
		switch val := v.(type) {
		case string:
			result[k] = val
		case float64:
			result[k] = fmt.Sprintf("%g", val)
		case int:
			result[k] = fmt.Sprintf("%d", val)
		case bool:
			result[k] = fmt.Sprintf("%t", val)
		default:
			result[k] = fmt.Sprintf("%v", val)
		}
	}
	return result
}

// Ensure interface compliance
var _ HybridSearcher = (*HybridSearchAdapter)(nil)
