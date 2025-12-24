package endpoint

import (
	"context"
	"sync"
)

// ===================================================
// Discovery Interfaces
// Used for hybrid NER/EPP extraction (Pattern + LLM)
// ===================================================

// Mention represents an entity mention extracted from content.
type Mention struct {
	Text       string  // Raw text, e.g., "@johndoe", "JIRA-123"
	Type       string  // "person", "issue", "channel", "system"
	EntityRef  string  // Resolved canonical entity reference
	Confidence float32 // 1.0 for pattern-based, varies for LLM
	Source     string  // "pattern" or "llm"
	Offset     int     // Character offset in source content
	Length     int     // Length of match in characters
}

// MentionExtractor extracts entity mentions from record content.
// Endpoints implement this for pattern-based extraction (regex, rules).
// Brain layer complements with LLM-based NER for complex entities.
type MentionExtractor interface {
	// ExtractMentions extracts entity mentions from a record payload.
	// Returns pattern-matched mentions with confidence=1.0.
	ExtractMentions(ctx context.Context, payload Record) []Mention
}

// Relation represents a relationship between entities.
type Relation struct {
	FromRef    string            // Source entity reference
	ToRef      string            // Target entity reference
	Type       string            // "ASSIGNED_TO", "FIXES", "PARENT_OF", "MENTIONS"
	Direction  RelationDirection // Forward, Backward, Both
	Properties map[string]any    // Additional relation properties
	Explicit   bool              // true = source-provided, false = inferred
	Confidence float32           // 1.0 for explicit, varies for inferred
}

// RelationDirection indicates edge traversal direction.
type RelationDirection string

const (
	RelationForward  RelationDirection = "forward"
	RelationBackward RelationDirection = "backward"
	RelationBoth     RelationDirection = "both"
)

// RelationExtractor extracts explicit relationships from record content.
// Endpoints implement this for schema-based extraction (links, references).
// Brain layer complements with LLM-based relation inference.
type RelationExtractor interface {
	// ExtractRelations extracts relationships from a record payload.
	// Returns explicit relations from source schema (assignee, parent, etc).
	ExtractRelations(ctx context.Context, payload Record) []Relation
}

// EntityType classifies an entity for EPP discovery.
type EntityType string

const (
	EntityTypeEntity  EntityType = "entity"  // Standard entity (issue, doc, user)
	EntityTypePolicy  EntityType = "policy"  // Policy document with rules
	EntityTypeProcess EntityType = "process" // Workflow or process definition
)

// EntityMapper maps raw records to canonical entities.
// Extended for EPP (Entity-Policy-Process) classification.
type EntityMapper interface {
	// MapToEntity maps a record to canonical entity format.
	MapToEntity(ctx context.Context, payload Record) Entity

	// GetQualifiers returns disambiguation qualifiers for the entity.
	GetQualifiers(ctx context.Context, payload Record) map[string]string

	// GetEntityType classifies the record as entity/policy/process.
	// Returns empty string if classification should be delegated to LLM.
	GetEntityType(ctx context.Context, payload Record) EntityType
}

// Entity represents a canonical entity after mapping.
type Entity struct {
	ID         string            // Unique entity ID
	Type       string            // Entity type/kind
	Name       string            // Display name
	Aliases    []string          // Alternative names
	Qualifiers map[string]string // Disambiguation qualifiers
	Properties map[string]any    // Entity properties
	Source     string            // Source system
	SourceID   string            // ID in source system
}

// ===================================================
// Discovery Registries
// P1 Fix: Thread-safe with sync.RWMutex
// ===================================================

// DiscoveryRegistry holds endpoint discovery implementations.
// Thread-safe for concurrent registration and lookup.
type DiscoveryRegistry struct {
	mu                 sync.RWMutex
	mentionExtractors  map[string]MentionExtractor
	relationExtractors map[string]RelationExtractor
	entityMappers      map[string]EntityMapper
}

var globalDiscoveryRegistry = &DiscoveryRegistry{
	mentionExtractors:  make(map[string]MentionExtractor),
	relationExtractors: make(map[string]RelationExtractor),
	entityMappers:      make(map[string]EntityMapper),
}

// NewDiscoveryRegistry creates an empty discovery registry.
// P2 Fix: Constructor to avoid nil map panic on zero-value DiscoveryRegistry.
func NewDiscoveryRegistry() *DiscoveryRegistry {
	return &DiscoveryRegistry{
		mentionExtractors:  make(map[string]MentionExtractor),
		relationExtractors: make(map[string]RelationExtractor),
		entityMappers:      make(map[string]EntityMapper),
	}
}

// DefaultDiscoveryRegistry returns the global discovery registry.
func DefaultDiscoveryRegistry() *DiscoveryRegistry {
	return globalDiscoveryRegistry
}

// RegisterMentionExtractor registers a mention extractor for an endpoint.
func (r *DiscoveryRegistry) RegisterMentionExtractor(endpointID string, extractor MentionExtractor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mentionExtractors[endpointID] = extractor
}

// GetMentionExtractor gets the mention extractor for an endpoint.
func (r *DiscoveryRegistry) GetMentionExtractor(endpointID string) (MentionExtractor, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.mentionExtractors[endpointID]
	return e, ok
}

// RegisterRelationExtractor registers a relation extractor for an endpoint.
func (r *DiscoveryRegistry) RegisterRelationExtractor(endpointID string, extractor RelationExtractor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.relationExtractors[endpointID] = extractor
}

// GetRelationExtractor gets the relation extractor for an endpoint.
func (r *DiscoveryRegistry) GetRelationExtractor(endpointID string) (RelationExtractor, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.relationExtractors[endpointID]
	return e, ok
}

// RegisterEntityMapper registers an entity mapper for an endpoint.
func (r *DiscoveryRegistry) RegisterEntityMapper(endpointID string, mapper EntityMapper) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entityMappers[endpointID] = mapper
}

// GetEntityMapper gets the entity mapper for an endpoint.
func (r *DiscoveryRegistry) GetEntityMapper(endpointID string) (EntityMapper, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.entityMappers[endpointID]
	return m, ok
}

