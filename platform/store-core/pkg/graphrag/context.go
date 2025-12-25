package graphrag

import (
	"context"
	"fmt"
	"time"
)

// ===================================================
// Context Builder
// Combines vector search with KG expansion and
// community context for comprehensive RAG queries
// ===================================================

// DefaultContextBuilder implements ContextBuilder using configured providers.
// Uses HybridSearcher for combined vector + keyword (FTS) search.
type DefaultContextBuilder struct {
	hybridSearcher    HybridSearcher
	embeddingProvider EmbeddingProvider // Optional: generates embeddings from text
	graphExpander     GraphExpander
	communityProvider CommunityProvider
}

// EmbeddingProvider generates embeddings from text queries.
// This is optional - if nil, hybrid search will use only keyword matching.
type EmbeddingProvider interface {
	Embed(ctx context.Context, text string) ([]float32, error)
}

// NewDefaultContextBuilder creates a new context builder.
func NewDefaultContextBuilder(
	hybridSearcher HybridSearcher,
	embeddingProvider EmbeddingProvider,
	graphExpander GraphExpander,
	communityProvider CommunityProvider,
) *DefaultContextBuilder {
	return &DefaultContextBuilder{
		hybridSearcher:    hybridSearcher,
		embeddingProvider: embeddingProvider,
		graphExpander:     graphExpander,
		communityProvider: communityProvider,
	}
}

// BuildContext creates a complete RAG context for a query.
func (b *DefaultContextBuilder) BuildContext(
	ctx context.Context,
	tenantID, query string,
	config ContextBuilderConfig,
) (*RAGContext, error) {
	start := time.Now()

	// Validate inputs
	if tenantID == "" {
		return nil, fmt.Errorf("tenantID is required")
	}
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}

	// Apply defaults
	config = applyContextBuilderDefaults(config)

	// Create context
	ragCtx := NewRAGContext(tenantID, query)

	// Phase 1: Hybrid search (vector + keyword) for seed entities
	if b.hybridSearcher != nil {
		// Generate embedding if provider available
		var embedding []float32
		if b.embeddingProvider != nil {
			if emb, err := b.embeddingProvider.Embed(ctx, query); err == nil {
				embedding = emb
			}
			// If embedding fails, continue with keyword-only search
		}

		hybridConfig := HybridSearchConfig{
			TopK:          config.TopK,
			VectorWeight:  0.5,
			KeywordWeight: 0.5,
			MinScore:      config.ScoreThreshold,
		}

		seeds, err := b.hybridSearcher.Search(
			ctx,
			tenantID,
			query,
			embedding,
			hybridConfig,
		)
		if err != nil {
			// Log but continue - search failure shouldn't block everything
		} else {
			for _, seed := range seeds {
				ragCtx.AddSeed(seed)
			}
		}
	}

	// Phase 2: Graph expansion from seed entities
	if b.graphExpander != nil && len(ragCtx.SeedEntities) > 0 {
		seedIDs := make([]string, 0, len(ragCtx.SeedEntities))
		for _, seed := range ragCtx.SeedEntities {
			seedIDs = append(seedIDs, seed.ID)
		}

		expansionConfig := ExpansionConfig{
			MaxHops:        config.MaxHops,
			MaxNodesPerHop: config.MaxNodesPerHop,
			MaxTotalNodes:  config.MaxTotalNodes,
			EdgeTypes:      config.EdgeTypes,
			Direction:      EdgeDirectionAny,
		}

		expansion, err := b.graphExpander.Expand(ctx, tenantID, seedIDs, expansionConfig)
		if err != nil {
			// Log but continue
		} else if expansion != nil {
			ragCtx.ExpandedGraph = expansion
		}
	}

	// Phase 3: Get community context
	if b.communityProvider != nil && config.IncludeCommunities {
		allNodeIDs := ragCtx.GetAllNodeIDs()
		if len(allNodeIDs) > 0 {
			communities, err := b.communityProvider.GetCommunitiesForEntities(
				ctx,
				tenantID,
				allNodeIDs,
				config.MaxCommunities,
			)
			if err != nil {
				// Log but continue
			} else {
				for _, community := range communities {
					ragCtx.AddCommunity(community)
				}
			}
		}
	}

	// Record processing time
	ragCtx.ProcessingTime = time.Since(start)

	return ragCtx, nil
}

// applyContextBuilderDefaults fills in missing numeric config values.
// IMPORTANT: Boolean fields (IncludeCommunities, IncludeContent) are NOT defaulted here.
// This is because Go's bool zero value is false, and we cannot distinguish between
// "caller set to false" vs "caller left unset". 
// RECOMMENDATION: Callers who want default behavior (communities/content enabled)
// should start with DefaultContextBuilderConfig() and modify as needed.
// Callers passing a zero-value config will get communities/content disabled.
func applyContextBuilderDefaults(config ContextBuilderConfig) ContextBuilderConfig {
	defaults := DefaultContextBuilderConfig()
	
	if config.TopK <= 0 {
		config.TopK = defaults.TopK
	}
	if config.ScoreThreshold <= 0 {
		config.ScoreThreshold = defaults.ScoreThreshold
	}
	if config.MaxHops <= 0 {
		config.MaxHops = defaults.MaxHops
	}
	if config.MaxNodesPerHop <= 0 {
		config.MaxNodesPerHop = defaults.MaxNodesPerHop
	}
	if config.MaxTotalNodes <= 0 {
		config.MaxTotalNodes = defaults.MaxTotalNodes
	}
	if config.MaxCommunities <= 0 {
		config.MaxCommunities = defaults.MaxCommunities
	}
	if config.MaxContentLength <= 0 {
		config.MaxContentLength = defaults.MaxContentLength
	}
	
	// Boolean fields (IncludeCommunities, IncludeContent) are NOT overridden.
	// Callers wanting these enabled should use DefaultContextBuilderConfig() as base.
	
	return config
}

// ===================================================
// Minimal Context Builder (Hybrid Search Only)
// For cases where only search is needed (no KG expansion)
// ===================================================

// SearchOnlyContextBuilder builds context using only hybrid search.
type SearchOnlyContextBuilder struct {
	hybridSearcher    HybridSearcher
	embeddingProvider EmbeddingProvider
}

// NewSearchOnlyContextBuilder creates a search-only context builder.
func NewSearchOnlyContextBuilder(hybridSearcher HybridSearcher, embeddingProvider EmbeddingProvider) *SearchOnlyContextBuilder {
	return &SearchOnlyContextBuilder{
		hybridSearcher:    hybridSearcher,
		embeddingProvider: embeddingProvider,
	}
}

// BuildContext creates a context with only hybrid search results (no KG expansion).
func (b *SearchOnlyContextBuilder) BuildContext(
	ctx context.Context,
	tenantID, query string,
	config ContextBuilderConfig,
) (*RAGContext, error) {
	start := time.Now()

	if tenantID == "" {
		return nil, fmt.Errorf("tenantID is required")
	}
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}
	if b.hybridSearcher == nil {
		return nil, fmt.Errorf("hybrid searcher not configured")
	}

	config = applyContextBuilderDefaults(config)
	ragCtx := NewRAGContext(tenantID, query)

	// Generate embedding if provider available
	var embedding []float32
	if b.embeddingProvider != nil {
		if emb, err := b.embeddingProvider.Embed(ctx, query); err == nil {
			embedding = emb
		}
	}

	hybridConfig := HybridSearchConfig{
		TopK:          config.TopK,
		VectorWeight:  0.5,
		KeywordWeight: 0.5,
		MinScore:      config.ScoreThreshold,
	}

	seeds, err := b.hybridSearcher.Search(
		ctx,
		tenantID,
		query,
		embedding,
		hybridConfig,
	)
	if err != nil {
		return nil, fmt.Errorf("hybrid search failed: %w", err)
	}

	for _, seed := range seeds {
		ragCtx.AddSeed(seed)
	}

	ragCtx.ProcessingTime = time.Since(start)
	return ragCtx, nil
}

// ===================================================
// Cached Context Builder
// Adds caching layer for repeated queries
// ===================================================

// CacheKey generates a cache key for a query.
// P1+P2 Fix: Include ALL config fields that affect the built context.
type CacheKey struct {
	TenantID           string
	Query              string
	TopK               int
	ScoreThreshold     float32
	MaxHops            int
	MaxNodesPerHop     int
	MaxTotalNodes      int
	EdgeTypes          string // Join of edge types
	IncludeCommunities bool
	MaxCommunities     int
	IncludeContent     bool
	MaxContentLength   int
}

// ContextCache defines the caching interface.
type ContextCache interface {
	Get(key CacheKey) (*RAGContext, bool)
	Set(key CacheKey, ctx *RAGContext)
}

// CachedContextBuilder wraps another builder with caching.
type CachedContextBuilder struct {
	inner ContextBuilder
	cache ContextCache
}

// NewCachedContextBuilder creates a cached context builder.
func NewCachedContextBuilder(inner ContextBuilder, cache ContextCache) *CachedContextBuilder {
	return &CachedContextBuilder{
		inner: inner,
		cache: cache,
	}
}

// BuildContext checks cache first, then delegates to inner builder.
func (b *CachedContextBuilder) BuildContext(
	ctx context.Context,
	tenantID, query string,
	config ContextBuilderConfig,
) (*RAGContext, error) {
	if b.cache == nil || b.inner == nil {
		if b.inner == nil {
			return nil, fmt.Errorf("inner context builder not configured")
		}
		return b.inner.BuildContext(ctx, tenantID, query, config)
	}

	// P3 Fix: Apply defaults before generating cache key so that
	// callers with equivalent configs (some zero, some explicit) share cache
	config = applyContextBuilderDefaults(config)

	// P1 Fix: Include all config fields in cache key
	edgeTypesStr := ""
	for i, et := range config.EdgeTypes {
		if i > 0 {
			edgeTypesStr += ","
		}
		edgeTypesStr += et
	}

	key := CacheKey{
		TenantID:           tenantID,
		Query:              query,
		TopK:               config.TopK,
		ScoreThreshold:     config.ScoreThreshold,
		MaxHops:            config.MaxHops,
		MaxNodesPerHop:     config.MaxNodesPerHop,
		MaxTotalNodes:      config.MaxTotalNodes,
		EdgeTypes:          edgeTypesStr,
		IncludeCommunities: config.IncludeCommunities,
		MaxCommunities:     config.MaxCommunities,
		IncludeContent:     config.IncludeContent,
		MaxContentLength:   config.MaxContentLength,
	}

	// Check cache
	if cached, ok := b.cache.Get(key); ok {
		return cached, nil
	}

	// Build and cache
	result, err := b.inner.BuildContext(ctx, tenantID, query, config)
	if err != nil {
		return nil, err
	}

	b.cache.Set(key, result)
	return result, nil
}

// ===================================================
// In-Memory Cache Implementation
// Simple LRU-like cache for development/testing
// ===================================================

// InMemoryContextCache provides a simple in-memory cache.
type InMemoryContextCache struct {
	entries  map[string]*RAGContext
	maxSize  int
	insertOrder []string
}

// NewInMemoryContextCache creates a new in-memory cache.
func NewInMemoryContextCache(maxSize int) *InMemoryContextCache {
	if maxSize <= 0 {
		maxSize = 100
	}
	return &InMemoryContextCache{
		entries:     make(map[string]*RAGContext),
		maxSize:     maxSize,
		insertOrder: make([]string, 0, maxSize),
	}
}

// cacheKeyString converts a CacheKey to string.
// P2 Fix: Include all fields in key string with full precision for floats.
func cacheKeyString(key CacheKey) string {
	return fmt.Sprintf("%s:%s:%d:%g:%d:%d:%d:%s:%t:%d:%t:%d",
		key.TenantID, key.Query, key.TopK, key.ScoreThreshold,
		key.MaxHops, key.MaxNodesPerHop, key.MaxTotalNodes,
		key.EdgeTypes, key.IncludeCommunities, key.MaxCommunities,
		key.IncludeContent, key.MaxContentLength)
}

// Get retrieves a cached context.
func (c *InMemoryContextCache) Get(key CacheKey) (*RAGContext, bool) {
	keyStr := cacheKeyString(key)
	ctx, ok := c.entries[keyStr]
	return ctx, ok
}

// Set stores a context in cache.
func (c *InMemoryContextCache) Set(key CacheKey, ctx *RAGContext) {
	keyStr := cacheKeyString(key)
	
	// P2 Fix: If key already exists, don't add to insertOrder again
	// Check if it's a new entry vs update
	isNew := c.entries[keyStr] == nil
	
	// Evict oldest if at capacity and this is a new entry
	if isNew && len(c.entries) >= c.maxSize {
		if len(c.insertOrder) > 0 {
			oldest := c.insertOrder[0]
			delete(c.entries, oldest)
			c.insertOrder = c.insertOrder[1:]
		}
	}
	
	c.entries[keyStr] = ctx
	// Only append to order if this is a new key
	if isNew {
		c.insertOrder = append(c.insertOrder, keyStr)
	}
}

// Ensure interface compliance
var _ ContextBuilder = (*DefaultContextBuilder)(nil)
var _ ContextBuilder = (*SearchOnlyContextBuilder)(nil)
var _ ContextBuilder = (*CachedContextBuilder)(nil)
var _ ContextCache = (*InMemoryContextCache)(nil)
