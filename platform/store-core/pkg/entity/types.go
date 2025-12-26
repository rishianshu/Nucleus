package entity

import (
	"context"
	"time"
)

// ===================================================
// Canonical Entity Registry
// Cross-source entity deduplication and resolution
// ===================================================

// CanonicalEntity represents a unified entity across sources.
// Multiple source entities (mentions) can map to one canonical entity.
type CanonicalEntity struct {
	ID          string            `json:"id"`          // Stable canonical ID
	TenantID    string            `json:"tenantId"`    // Tenant isolation
	Type        string            `json:"type"`        // Entity type: person, project, document, policy, process
	Name        string            `json:"name"`        // Primary display name
	Aliases     []string          `json:"aliases"`     // Alternative names/identifiers
	Qualifiers  map[string]string `json:"qualifiers"`  // Disambiguation qualifiers (e.g., department, specialty)
	Properties  map[string]any    `json:"properties"`  // Merged properties from all sources
	SourceRefs  []SourceRef       `json:"sourceRefs"`  // References to source entities
	CreatedAt   time.Time         `json:"createdAt"`   // First seen
	UpdatedAt   time.Time         `json:"updatedAt"`   // Last updated
	MergedFrom  []string          `json:"mergedFrom"`  // IDs of entities merged into this one
}

// SourceRef links a canonical entity to a source system entity.
type SourceRef struct {
	Source     string `json:"source"`     // Source system: jira, github, confluence
	ExternalID string `json:"externalId"` // ID in source system
	NodeID     string `json:"nodeId"`     // Brain NodeID (for vector/KG linking)
	URL        string `json:"url"`        // Link to source
	LastSynced time.Time `json:"lastSynced"` // Last sync time
}

// EntityType classifies entities for EPP (Entity-Policy-Process).
type EntityType string

const (
	EntityTypeEntity  EntityType = "entity"  // Standard entity (person, project, item)
	EntityTypePolicy  EntityType = "policy"  // Policy document with rules
	EntityTypeProcess EntityType = "process" // Workflow or process definition
)

// ===================================================
// Matching Rules
// ===================================================

// MatchRule defines how to match entities across sources.
type MatchRule struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Priority    int      `json:"priority"` // Higher = checked first
	EntityTypes []string `json:"entityTypes"` // Types this rule applies to
	Condition   MatchCondition `json:"condition"`
}

// MatchCondition specifies the matching logic.
type MatchCondition struct {
	// Exact match on specific fields
	ExactFields []string `json:"exactFields"` // e.g., ["email", "employeeId"]
	
	// Fuzzy match on name with threshold
	FuzzyNameThreshold float32 `json:"fuzzyNameThreshold"` // 0-1, e.g., 0.85
	
	// Qualifier constraints (must match if present)
	RequiredQualifiers []string `json:"requiredQualifiers"` // e.g., ["department"]
	
	// Source-specific patterns
	SourcePatterns map[string]string `json:"sourcePatterns"` // source -> regex pattern
}

// MatchResult represents a potential entity match.
type MatchResult struct {
	CanonicalID string  `json:"canonicalId"`
	Score       float32 `json:"score"`       // Match confidence
	MatchedBy   string  `json:"matchedBy"`   // Rule ID that matched
	Reason      string  `json:"reason"`      // Human-readable explanation
}

// ===================================================
// Entity Resolution Interfaces
// ===================================================

// EntityRegistry manages canonical entities.
type EntityRegistry interface {
	// Create creates a new canonical entity.
	Create(ctx context.Context, entity *CanonicalEntity) error
	
	// Get retrieves an entity by canonical ID.
	Get(ctx context.Context, tenantID, id string) (*CanonicalEntity, error)
	
	// GetBySourceRef retrieves by source reference.
	GetBySourceRef(ctx context.Context, tenantID, source, externalID string) (*CanonicalEntity, error)
	
	// Update updates an existing entity.
	Update(ctx context.Context, entity *CanonicalEntity) error
	
	// Delete removes an entity.
	Delete(ctx context.Context, tenantID, id string) error
	
	// List lists entities with filters.
	List(ctx context.Context, tenantID string, filter EntityFilter, limit, offset int) ([]*CanonicalEntity, error)
	
	// AddAlias adds an alias to an entity.
	AddAlias(ctx context.Context, tenantID, id, alias string) error
	
	// AddSourceRef links a source entity to a canonical entity.
	AddSourceRef(ctx context.Context, tenantID, id string, ref SourceRef) error
	
	// Merge merges two entities, returning the surviving entity.
	Merge(ctx context.Context, tenantID, survivorID, mergedID string) (*CanonicalEntity, error)
}

// EntityFilter for listing entities.
type EntityFilter struct {
	Types      []string          `json:"types"`
	NameLike   string            `json:"nameLike"`
	Qualifiers map[string]string `json:"qualifiers"`
	Source     string            `json:"source"`
	UpdatedAfter time.Time       `json:"updatedAfter"`
}

// EntityMatcher finds matching canonical entities for source entities.
type EntityMatcher interface {
	// FindMatches returns potential canonical entity matches for a source entity.
	FindMatches(ctx context.Context, tenantID string, source SourceEntity) ([]MatchResult, error)
	
	// ResolveOrCreate finds a match or creates a new canonical entity.
	ResolveOrCreate(ctx context.Context, tenantID string, source SourceEntity) (*CanonicalEntity, bool, error)
}

// SourceEntity represents an entity from a source system.
type SourceEntity struct {
	Source      string            `json:"source"`      // Source system
	ExternalID  string            `json:"externalId"`  // ID in source
	Type        string            `json:"type"`        // Entity type
	Name        string            `json:"name"`        // Display name
	Email       string            `json:"email"`       // Email (for persons)
	Aliases     []string          `json:"aliases"`     // Known aliases
	Qualifiers  map[string]string `json:"qualifiers"`  // Disambiguation qualifiers
	Properties  map[string]any    `json:"properties"`  // Additional properties
	URL         string            `json:"url"`         // Link to source
	NodeID      string            `json:"nodeId"`      // Brain NodeID
}

// ===================================================
// EPP (Entity-Policy-Process) Classification
// ===================================================

// EPPClassifier determines if an entity is a policy or process.
type EPPClassifier interface {
	// Classify returns the EPP type for an entity.
	Classify(ctx context.Context, entity SourceEntity) (EntityType, float32, error)
}

// PolicyEntity extends CanonicalEntity for policies.
type PolicyEntity struct {
	CanonicalEntity
	Rules       []PolicyRule `json:"rules"`       // Extracted rules
	AppliesTo   []string     `json:"appliesTo"`   // Entity types this applies to
	Enforcement string       `json:"enforcement"` // mandatory, recommended, optional
}

// PolicyRule represents an extracted rule from a policy.
type PolicyRule struct {
	ID          string   `json:"id"`
	Description string   `json:"description"`
	Keywords    []string `json:"keywords"`
	Requirement string   `json:"requirement"` // must, should, may
}

// ProcessEntity extends CanonicalEntity for processes.
type ProcessEntity struct {
	CanonicalEntity
	Steps       []ProcessStep `json:"steps"`
	Triggers    []string      `json:"triggers"`
	Outcomes    []string      `json:"outcomes"`
}

// ProcessStep represents a step in a process.
type ProcessStep struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Actor       string   `json:"actor"`    // Who performs this step
	Inputs      []string `json:"inputs"`   // Required inputs
	Outputs     []string `json:"outputs"`  // Produced outputs
	NextSteps   []string `json:"nextSteps"` // Following step IDs
}

// ===================================================
// Default Match Rules
// ===================================================

// DefaultMatchRules returns standard matching rules.
func DefaultMatchRules() []MatchRule {
	return []MatchRule{
		{
			ID:          "email-exact",
			Name:        "Email Exact Match",
			Description: "Match persons by exact email address",
			Priority:    100,
			EntityTypes: []string{"person"},
			Condition: MatchCondition{
				ExactFields: []string{"email"},
			},
		},
		{
			ID:          "external-id-source",
			Name:        "Same Source External ID",
			Description: "Match by external ID within same source",
			Priority:    90,
			EntityTypes: []string{}, // All types
			Condition: MatchCondition{
				ExactFields: []string{"source", "externalId"},
			},
		},
		{
			ID:          "name-qualified",
			Name:        "Name with Qualifiers",
			Description: "Match by name + required qualifiers",
			Priority:    70,
			EntityTypes: []string{"person", "project"},
			Condition: MatchCondition{
				FuzzyNameThreshold: 0.90,
				RequiredQualifiers: []string{"organization"},
			},
		},
		{
			ID:          "name-fuzzy",
			Name:        "Fuzzy Name Match",
			Description: "Match by fuzzy name similarity",
			Priority:    50,
			EntityTypes: []string{"project", "document"},
			Condition: MatchCondition{
				FuzzyNameThreshold: 0.85,
			},
		},
	}
}
