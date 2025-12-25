package endpoint

import "sync"

// VectorIndexRecord represents a normalized record ready for vector indexing.
// This is the output format expected by brain-worker for embedding and storage.
type VectorIndexRecord struct {
	NodeID       string         `json:"nodeId"`       // Stable unique identifier
	ProfileID    string         `json:"profileId"`    // Vector profile ID (e.g., source.github.code.v1)
	EntityKind   string         `json:"entityKind"`   // Entity type (e.g., code.file_chunk, work.item)
	Text         string         `json:"text"`         // Content to embed
	SourceFamily string         `json:"sourceFamily"` // Source system (e.g., github, jira)
	TenantID     string         `json:"tenantId"`     // Tenant identifier
	ProjectKey   string         `json:"projectKey"`   // Project identifier (e.g., owner/repo)
	SourceURL    string         `json:"sourceUrl"`    // URL to source item
	ExternalID   string         `json:"externalId"`   // External system ID
	Metadata     map[string]any `json:"metadata"`     // Additional metadata
	RawPayload   map[string]any `json:"rawPayload"`   // Original payload for reference
	
	// Multi-record fields (for aspect-based embeddings)
	Aspect       string         `json:"aspect"`       // Aspect type: "title", "description", "comments", "metadata"
	ChunkIndex   int            `json:"chunkIndex"`   // Chunk index within aspect (for long content)
	ParentNodeID string         `json:"parentNodeId"` // Parent entity's NodeID (for linking chunks)
	EmbeddingType string        `json:"embeddingType"` // "dense" or "sparse" (BM25)
}

// VectorProfileProvider is an optional interface that endpoints can implement
// to provide vector indexing support. When an endpoint implements this interface,
// the staging layer will automatically produce normalized VectorIndexRecords
// that brain-worker can directly embed and store.
type VectorProfileProvider interface {
	// GetVectorProfile returns the profile ID for a given entity kind.
	// This determines which normalizer and embedding settings to use.
	GetVectorProfile(entityKind string) string

	// NormalizeForIndex transforms a raw ingestion record into a normalized
	// VectorIndexRecord suitable for embedding. Returns false if the record
	// should not be indexed (e.g., missing required fields).
	NormalizeForIndex(rec Record) (VectorIndexRecord, bool)
}

// ===================================================
// Multi-Record Vector Profile Provider
// Produces multiple vector records per source entity
// for aspect-based search (title, description, etc.)
// ===================================================

// AspectConfig configures how an aspect should be processed.
type AspectConfig struct {
	Name          string `json:"name"`          // Aspect name: "title", "description", "comments"
	EmbeddingType string `json:"embeddingType"` // "dense" or "sparse"
	ChunkStrategy string `json:"chunkStrategy"` // "none", "paragraph", "sliding_window", "sentence"
	MaxChunkSize  int    `json:"maxChunkSize"`  // Max chars per chunk (0 = no limit)
	ChunkOverlap  int    `json:"chunkOverlap"`  // Overlap between chunks
}

// DefaultAspectConfigs returns standard aspect configurations.
func DefaultAspectConfigs() []AspectConfig {
	return []AspectConfig{
		{Name: "title", EmbeddingType: "dense", ChunkStrategy: "none", MaxChunkSize: 0},
		{Name: "description", EmbeddingType: "dense", ChunkStrategy: "paragraph", MaxChunkSize: 1000, ChunkOverlap: 100},
		{Name: "comments", EmbeddingType: "dense", ChunkStrategy: "sliding_window", MaxChunkSize: 500, ChunkOverlap: 50},
		{Name: "metadata", EmbeddingType: "sparse", ChunkStrategy: "none", MaxChunkSize: 0},
	}
}

// MultiRecordVectorProfileProvider produces multiple vector records per entity.
// This enables aspect-based search where title, description, and comments
// can be searched independently with different embedding strategies.
type MultiRecordVectorProfileProvider interface {
	// GetVectorProfiles returns all profile IDs this provider supports.
	GetVectorProfiles() []string

	// NormalizeForMultiIndex transforms a record into multiple VectorIndexRecords.
	// Each record represents a different aspect (title, description, comments).
	// Returns empty slice if the record should not be indexed.
	NormalizeForMultiIndex(rec Record) []VectorIndexRecord

	// GetAspectConfigs returns the aspect configurations for this provider.
	GetAspectConfigs() []AspectConfig
}

// ===================================================
// Multi-Record Provider Registry
// ===================================================

var (
	multiRecordProviders   = make(map[string]MultiRecordVectorProfileProvider)
	multiRecordProvidersMu sync.RWMutex
)

// RegisterMultiRecordProvider registers a multi-record provider for an endpoint.
func RegisterMultiRecordProvider(endpointID string, provider MultiRecordVectorProfileProvider) {
	multiRecordProvidersMu.Lock()
	defer multiRecordProvidersMu.Unlock()
	multiRecordProviders[endpointID] = provider
}

// GetMultiRecordProvider returns the multi-record provider for an endpoint.
func GetMultiRecordProvider(endpointID string) (MultiRecordVectorProfileProvider, bool) {
	multiRecordProvidersMu.RLock()
	defer multiRecordProvidersMu.RUnlock()
	p, ok := multiRecordProviders[endpointID]
	return p, ok
}

// ===================================================
// Chunking Utilities
// ===================================================

// ChunkText splits text into chunks based on strategy.
func ChunkText(text string, config AspectConfig) []string {
	if text == "" {
		return nil
	}

	switch config.ChunkStrategy {
	case "none":
		return []string{text}
	case "paragraph":
		return chunkByParagraph(text, config.MaxChunkSize, config.ChunkOverlap)
	case "sliding_window":
		return chunkBySlidingWindow(text, config.MaxChunkSize, config.ChunkOverlap)
	case "sentence":
		return chunkBySentence(text, config.MaxChunkSize, config.ChunkOverlap)
	default:
		return []string{text}
	}
}

// chunkByParagraph splits text by paragraph boundaries.
func chunkByParagraph(text string, maxSize, overlap int) []string {
	if maxSize <= 0 {
		return []string{text}
	}

	var chunks []string
	paragraphs := splitParagraphs(text)
	
	var current string
	for _, para := range paragraphs {
		if len(current)+len(para) > maxSize && current != "" {
			chunks = append(chunks, current)
			// Add overlap from end of previous chunk
			if overlap > 0 && len(current) > overlap {
				current = current[len(current)-overlap:] + "\n\n" + para
			} else {
				current = para
			}
		} else {
			if current != "" {
				current += "\n\n" + para
			} else {
				current = para
			}
		}
	}
	if current != "" {
		chunks = append(chunks, current)
	}
	return chunks
}

// chunkBySlidingWindow creates overlapping fixed-size chunks.
func chunkBySlidingWindow(text string, maxSize, overlap int) []string {
	if maxSize <= 0 || len(text) <= maxSize {
		return []string{text}
	}

	var chunks []string
	step := maxSize - overlap
	if step <= 0 {
		step = maxSize / 2
	}

	for i := 0; i < len(text); i += step {
		end := i + maxSize
		if end > len(text) {
			end = len(text)
		}
		chunks = append(chunks, text[i:end])
		if end >= len(text) {
			break
		}
	}
	return chunks
}

// chunkBySentence splits text by sentence boundaries.
func chunkBySentence(text string, maxSize, overlap int) []string {
	if maxSize <= 0 {
		return []string{text}
	}

	sentences := splitSentences(text)
	var chunks []string
	var current string

	for _, sent := range sentences {
		if len(current)+len(sent) > maxSize && current != "" {
			chunks = append(chunks, current)
			if overlap > 0 && len(current) > overlap {
				current = current[len(current)-overlap:] + " " + sent
			} else {
				current = sent
			}
		} else {
			if current != "" {
				current += " " + sent
			} else {
				current = sent
			}
		}
	}
	if current != "" {
		chunks = append(chunks, current)
	}
	return chunks
}

// splitParagraphs splits text into paragraphs.
func splitParagraphs(text string) []string {
	var paragraphs []string
	start := 0
	for i := 0; i < len(text); i++ {
		if i < len(text)-1 && text[i] == '\n' && text[i+1] == '\n' {
			if i > start {
				paragraphs = append(paragraphs, text[start:i])
			}
			start = i + 2
			i++ // Skip second newline
		}
	}
	if start < len(text) {
		paragraphs = append(paragraphs, text[start:])
	}
	return paragraphs
}

// splitSentences splits text into sentences (simple heuristic).
func splitSentences(text string) []string {
	var sentences []string
	start := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '.' || text[i] == '!' || text[i] == '?' {
			// Check for end of sentence (followed by space or end)
			if i+1 >= len(text) || text[i+1] == ' ' || text[i+1] == '\n' {
				sentences = append(sentences, text[start:i+1])
				start = i + 1
				// Skip whitespace
				for start < len(text) && (text[start] == ' ' || text[start] == '\n') {
					start++
				}
				i = start - 1
			}
		}
	}
	if start < len(text) {
		sentences = append(sentences, text[start:])
	}
	return sentences
}
