package ner

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/nucleus/store-core/pkg/entity"
)

// ===================================================
// Cross-Source Entity Observer
// Observes entities across sources for deduplication
// ===================================================

// ObservedEntity represents an entity observed from a source.
type ObservedEntity struct {
	ID           string            `json:"id"`           // Observation ID
	TenantID     string            `json:"tenantId"`     // Tenant
	SourceID     string            `json:"sourceId"`     // Source document ID
	SourceType   string            `json:"sourceType"`   // Source system
	SourceURL    string            `json:"sourceUrl"`    // Link to source
	Entity       ExtractedEntity   `json:"entity"`       // Extracted entity
	ObservedAt   time.Time         `json:"observedAt"`   // When observed
	Status       ObservationStatus `json:"status"`       // Processing status
	CanonicalID  string            `json:"canonicalId"`  // Resolved canonical entity ID (if any)
	MatchScore   float32           `json:"matchScore"`   // Match confidence
	MatchedBy    string            `json:"matchedBy"`    // Match rule that fired
}

// ObservationStatus tracks the state of an observation.
type ObservationStatus string

const (
	StatusPending   ObservationStatus = "pending"   // Awaiting resolution
	StatusMatched   ObservationStatus = "matched"   // Matched to existing entity
	StatusCreated   ObservationStatus = "created"   // New entity created
	StatusReview    ObservationStatus = "review"    // Needs manual review
	StatusMerged    ObservationStatus = "merged"    // Merged with another
	StatusRejected  ObservationStatus = "rejected"  // Rejected as invalid
)

// EntityObserver observes and resolves entities across sources.
type EntityObserver struct {
	mu          sync.RWMutex
	pending     map[string]*ObservedEntity // Pending observations by ID
	bySource    map[string][]string        // tenantId:sourceType:sourceId -> observation IDs
	byNormalized map[string][]string       // P0 Fix: tenantId:normalized:type -> observation IDs (tenant-scoped)
	matcher     entity.EntityMatcher
	threshold   float32 // Auto-merge threshold (default 0.9)
}

// NewEntityObserver creates a new entity observer.
func NewEntityObserver(matcher entity.EntityMatcher) *EntityObserver {
	return &EntityObserver{
		pending:      make(map[string]*ObservedEntity),
		bySource:     make(map[string][]string),
		byNormalized: make(map[string][]string),
		matcher:      matcher,
		threshold:    0.9,
	}
}

// SetAutoMergeThreshold sets the threshold for auto-merge.
func (o *EntityObserver) SetAutoMergeThreshold(threshold float32) {
	o.threshold = threshold
}

// Observe records an entity observation.
func (o *EntityObserver) Observe(ctx context.Context, tenantID string, extracted ExtractedEntity, sourceURL string) (*ObservedEntity, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Create observation
	obs := &ObservedEntity{
		ID:         generateObservationID(),
		TenantID:   tenantID,
		SourceID:   extracted.SourceID,
		SourceType: extracted.SourceType,
		SourceURL:  sourceURL,
		Entity:     extracted,
		ObservedAt: time.Now(),
		Status:     StatusPending,
	}

	// Store observation
	o.pending[obs.ID] = obs

	// P0 Fix: Include tenantID in all index keys for tenant isolation
	// Index by source (tenant-scoped)
	sourceKey := fmt.Sprintf("%s:%s:%s", tenantID, extracted.SourceType, extracted.SourceID)
	o.bySource[sourceKey] = append(o.bySource[sourceKey], obs.ID)

	// Index by normalized text + type (tenant-scoped)
	normalizedKey := fmt.Sprintf("%s:%s:%s", tenantID, extracted.Normalized, extracted.Type)
	o.byNormalized[normalizedKey] = append(o.byNormalized[normalizedKey], obs.ID)

	return obs, nil
}

// ResolveObservation attempts to resolve an observation to a canonical entity.
func (o *EntityObserver) ResolveObservation(ctx context.Context, obsID string) (*ObservedEntity, error) {
	o.mu.Lock()
	obs, exists := o.pending[obsID]
	if !exists {
		o.mu.Unlock()
		return nil, fmt.Errorf("observation not found: %s", obsID)
	}
	o.mu.Unlock()

	if obs.Status != StatusPending {
		return obs, nil // Already resolved
	}

	// Build source entity for matching
	source := entity.SourceEntity{
		Source:     obs.SourceType,
		ExternalID: obs.SourceID,
		Type:       string(obs.Entity.Type),
		Name:       obs.Entity.Normalized,
		Qualifiers: obs.Entity.Qualifiers,
		NodeID:     fmt.Sprintf("%s:%s:%s", obs.SourceType, obs.SourceID, obs.Entity.Text),
	}

	// P1 Fix: First use FindMatches to get match scores for threshold comparison
	matches, err := o.matcher.FindMatches(ctx, obs.TenantID, source)
	if err != nil {
		return nil, fmt.Errorf("failed to find matches: %w", err)
	}

	o.mu.Lock()
	defer o.mu.Unlock()

	if len(matches) > 0 {
		topMatch := matches[0]
		obs.MatchScore = topMatch.Score
		obs.MatchedBy = topMatch.MatchedBy

		// P1 Fix: Only set canonicalID when above threshold, leave empty for review
		if topMatch.Score >= o.threshold {
			obs.CanonicalID = topMatch.CanonicalID
			obs.Status = StatusMatched
		} else {
			// Below threshold - needs manual review, don't set canonical ID yet
			obs.Status = StatusReview
		}
	} else {
		// No matches found - create new canonical entity
		canonical, _, err := o.matcher.ResolveOrCreate(ctx, obs.TenantID, source)
		if err != nil {
			return nil, fmt.Errorf("failed to create entity: %w", err)
		}
		obs.CanonicalID = canonical.ID
		obs.MatchScore = 1.0
		obs.MatchedBy = "new"
		obs.Status = StatusCreated
	}

	return obs, nil
}

// GetPendingObservations returns all pending observations.
func (o *EntityObserver) GetPendingObservations(tenantID string) []*ObservedEntity {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var result []*ObservedEntity
	for _, obs := range o.pending {
		if obs.TenantID == tenantID && obs.Status == StatusPending {
			result = append(result, obs)
		}
	}
	return result
}

// GetReviewObservations returns observations needing review.
func (o *EntityObserver) GetReviewObservations(tenantID string) []*ObservedEntity {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var result []*ObservedEntity
	for _, obs := range o.pending {
		if obs.TenantID == tenantID && obs.Status == StatusReview {
			result = append(result, obs)
		}
	}
	return result
}

// FindCrossSourceMatches finds observations of the same entity across sources.
// P0 Fix: Added tenantID parameter to ensure tenant isolation.
func (o *EntityObserver) FindCrossSourceMatches(tenantID string, normalized string, entityType EntityType) []*ObservedEntity {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// P0 Fix: Include tenantID in key for tenant isolation
	key := fmt.Sprintf("%s:%s:%s", tenantID, normalized, entityType)
	obsIDs := o.byNormalized[key]

	var result []*ObservedEntity
	for _, id := range obsIDs {
		if obs, exists := o.pending[id]; exists {
			// Double-check tenant (defense in depth)
			if obs.TenantID == tenantID {
				result = append(result, obs)
			}
		}
	}
	return result
}

// GetObservationsBySource returns all observations from a source.
// P0 Fix: Added tenantID parameter to ensure tenant isolation.
func (o *EntityObserver) GetObservationsBySource(tenantID, sourceType, sourceID string) []*ObservedEntity {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// P0 Fix: Include tenantID in key for tenant isolation
	key := fmt.Sprintf("%s:%s:%s", tenantID, sourceType, sourceID)
	obsIDs := o.bySource[key]

	var result []*ObservedEntity
	for _, id := range obsIDs {
		if obs, exists := o.pending[id]; exists {
			// Double-check tenant (defense in depth)
			if obs.TenantID == tenantID {
				result = append(result, obs)
			}
		}
	}
	return result
}

// ApproveMatch approves a match for an observation.
// P1 Fix: Added tenantID parameter to prevent cross-tenant tampering.
func (o *EntityObserver) ApproveMatch(tenantID, obsID, canonicalID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	obs, exists := o.pending[obsID]
	if !exists {
		return fmt.Errorf("observation not found: %s", obsID)
	}

	// P1 Fix: Validate tenant to prevent cross-tenant access
	if obs.TenantID != tenantID {
		return fmt.Errorf("observation not found: %s", obsID) // Don't leak existence
	}

	obs.CanonicalID = canonicalID
	obs.Status = StatusMatched
	return nil
}

// RejectObservation marks an observation as rejected.
// P1 Fix: Added tenantID parameter to prevent cross-tenant tampering.
func (o *EntityObserver) RejectObservation(tenantID, obsID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	obs, exists := o.pending[obsID]
	if !exists {
		return fmt.Errorf("observation not found: %s", obsID)
	}

	// P1 Fix: Validate tenant to prevent cross-tenant access
	if obs.TenantID != tenantID {
		return fmt.Errorf("observation not found: %s", obsID) // Don't leak existence
	}

	obs.Status = StatusRejected

	return nil
}

// Stats returns observation statistics.
func (o *EntityObserver) Stats(tenantID string) ObserverStats {
	o.mu.RLock()
	defer o.mu.RUnlock()

	stats := ObserverStats{}
	for _, obs := range o.pending {
		if obs.TenantID != tenantID {
			continue
		}
		stats.Total++
		switch obs.Status {
		case StatusPending:
			stats.Pending++
		case StatusMatched:
			stats.Matched++
		case StatusCreated:
			stats.Created++
		case StatusReview:
			stats.NeedsReview++
		case StatusRejected:
			stats.Rejected++
		}
	}
	return stats
}

// ObserverStats holds observation statistics.
type ObserverStats struct {
	Total       int `json:"total"`
	Pending     int `json:"pending"`
	Matched     int `json:"matched"`
	Created     int `json:"created"`
	NeedsReview int `json:"needsReview"`
	Rejected    int `json:"rejected"`
}

// generateObservationID creates a unique observation ID.
func generateObservationID() string {
	return fmt.Sprintf("obs-%d", time.Now().UnixNano())
}

// ===================================================
// Cross-Source Entity View
// Aggregated view of entity across sources
// ===================================================

// CrossSourceEntityView provides a unified view of an entity across sources.
type CrossSourceEntityView struct {
	Normalized   string              `json:"normalized"`   // Canonical name
	Type         EntityType          `json:"type"`         // Entity type
	CanonicalID  string              `json:"canonicalId"`  // Canonical entity ID (if resolved)
	Observations []*ObservedEntity   `json:"observations"` // All observations
	Sources      []string            `json:"sources"`      // Unique source types
	FirstSeen    time.Time           `json:"firstSeen"`    // First observation
	LastSeen     time.Time           `json:"lastSeen"`     // Most recent observation
	Confidence   float32             `json:"confidence"`   // Aggregate confidence
}

// BuildCrossSourceView builds a view of an entity across all sources.
// P0 Fix: Added tenantID parameter to ensure tenant isolation.
func (o *EntityObserver) BuildCrossSourceView(tenantID string, normalized string, entityType EntityType) *CrossSourceEntityView {
	observations := o.FindCrossSourceMatches(tenantID, normalized, entityType)
	if len(observations) == 0 {
		return nil
	}

	view := &CrossSourceEntityView{
		Normalized:   normalized,
		Type:         entityType,
		Observations: observations,
		FirstSeen:    observations[0].ObservedAt,
		LastSeen:     observations[0].ObservedAt,
	}

	sourceSet := make(map[string]bool)
	var totalConfidence float32

	for _, obs := range observations {
		sourceSet[obs.SourceType] = true
		totalConfidence += obs.Entity.Confidence

		if obs.ObservedAt.Before(view.FirstSeen) {
			view.FirstSeen = obs.ObservedAt
		}
		if obs.ObservedAt.After(view.LastSeen) {
			view.LastSeen = obs.ObservedAt
		}

		if obs.CanonicalID != "" && view.CanonicalID == "" {
			view.CanonicalID = obs.CanonicalID
		}
	}

	for source := range sourceSet {
		view.Sources = append(view.Sources, source)
	}

	view.Confidence = totalConfidence / float32(len(observations))

	return view
}
