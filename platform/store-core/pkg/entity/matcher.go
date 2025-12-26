package entity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ===================================================
// Default Entity Matcher
// Cross-source entity resolution implementation
// ===================================================

// DefaultEntityMatcher implements EntityMatcher with configurable rules.
type DefaultEntityMatcher struct {
	registry EntityRegistry
	rules    []MatchRule
}

// NewDefaultEntityMatcher creates a new matcher with default rules.
func NewDefaultEntityMatcher(registry EntityRegistry) *DefaultEntityMatcher {
	return &DefaultEntityMatcher{
		registry: registry,
		rules:    DefaultMatchRules(),
	}
}

// NewEntityMatcherWithRules creates a matcher with custom rules.
func NewEntityMatcherWithRules(registry EntityRegistry, rules []MatchRule) *DefaultEntityMatcher {
	return &DefaultEntityMatcher{
		registry: registry,
		rules:    rules,
	}
}

// FindMatches finds potential canonical entity matches for a source entity.
func (m *DefaultEntityMatcher) FindMatches(ctx context.Context, tenantID string, source SourceEntity) ([]MatchResult, error) {
	var results []MatchResult

	// Check if already linked by source ref
	existing, err := m.registry.GetBySourceRef(ctx, tenantID, source.Source, source.ExternalID)
	if err == nil && existing != nil {
		results = append(results, MatchResult{
			CanonicalID: existing.ID,
			Score:       1.0,
			MatchedBy:   "source-ref",
			Reason:      fmt.Sprintf("Already linked to canonical entity %s", existing.ID),
		})
		return results, nil
	}

	// Get candidate entities to match against
	candidates, err := m.getCandidates(ctx, tenantID, source)
	if err != nil {
		return nil, fmt.Errorf("failed to get candidates: %w", err)
	}

	// Apply matching rules in priority order
	for _, candidate := range candidates {
		for _, rule := range m.rules {
			if !m.ruleApplies(rule, source.Type) {
				continue
			}

			score, matched := m.evaluateRule(rule, source, candidate)
			if matched && score > 0 {
				results = append(results, MatchResult{
					CanonicalID: candidate.ID,
					Score:       score,
					MatchedBy:   rule.ID,
					Reason:      fmt.Sprintf("Matched by %s (score: %.2f)", rule.Name, score),
				})
			}
		}
	}

	// Sort by score descending
	sortMatchResults(results)
	return results, nil
}

// ResolveOrCreate finds a match or creates a new canonical entity.
func (m *DefaultEntityMatcher) ResolveOrCreate(ctx context.Context, tenantID string, source SourceEntity) (*CanonicalEntity, bool, error) {
	matches, err := m.FindMatches(ctx, tenantID, source)
	if err != nil {
		return nil, false, err
	}

	// If high-confidence match found, link to it
	if len(matches) > 0 && matches[0].Score >= 0.9 {
		existing, err := m.registry.Get(ctx, tenantID, matches[0].CanonicalID)
		if err != nil {
			return nil, false, err
		}

		// Add source reference
		ref := SourceRef{
			Source:     source.Source,
			ExternalID: source.ExternalID,
			NodeID:     source.NodeID,
			URL:        source.URL,
			LastSynced: time.Now(),
		}
		if err := m.registry.AddSourceRef(ctx, tenantID, existing.ID, ref); err != nil {
			return nil, false, err
		}

		// Merge properties
		existing.Properties = mergeProperties(existing.Properties, source.Properties)
		existing.UpdatedAt = time.Now()
		if err := m.registry.Update(ctx, existing); err != nil {
			return nil, false, err
		}

		return existing, false, nil
	}

	// Create new canonical entity
	entity := &CanonicalEntity{
		ID:       generateCanonicalID(source),
		TenantID: tenantID,
		Type:     source.Type,
		Name:     source.Name,
		Aliases:  source.Aliases,
		Qualifiers: source.Qualifiers,
		Properties: source.Properties,
		SourceRefs: []SourceRef{
			{
				Source:     source.Source,
				ExternalID: source.ExternalID,
				NodeID:     source.NodeID,
				URL:        source.URL,
				LastSynced: time.Now(),
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := m.registry.Create(ctx, entity); err != nil {
		return nil, false, err
	}

	return entity, true, nil
}

// getCandidates retrieves candidate entities to match against.
func (m *DefaultEntityMatcher) getCandidates(ctx context.Context, tenantID string, source SourceEntity) ([]*CanonicalEntity, error) {
	filter := EntityFilter{
		Types:    []string{source.Type},
		NameLike: extractNamePrefix(source.Name),
	}

	// Get by type and name prefix
	candidates, err := m.registry.List(ctx, tenantID, filter, 100, 0)
	if err != nil {
		return nil, err
	}

	// Also get by email if present
	if source.Email != "" {
		emailFilter := EntityFilter{
			Types: []string{source.Type},
			// Would ideally search by email in properties
		}
		emailCandidates, err := m.registry.List(ctx, tenantID, emailFilter, 20, 0)
		if err == nil {
			candidates = append(candidates, emailCandidates...)
		}
	}

	// Deduplicate
	return deduplicateCandidates(candidates), nil
}

// ruleApplies checks if a rule applies to an entity type.
func (m *DefaultEntityMatcher) ruleApplies(rule MatchRule, entityType string) bool {
	if len(rule.EntityTypes) == 0 {
		return true // Applies to all types
	}
	for _, t := range rule.EntityTypes {
		if t == entityType {
			return true
		}
	}
	return false
}

// evaluateRule evaluates a single match rule.
// P2 Fix: Added SourcePatterns evaluation.
func (m *DefaultEntityMatcher) evaluateRule(rule MatchRule, source SourceEntity, candidate *CanonicalEntity) (float32, bool) {
	cond := rule.Condition

	// P2 Fix: Check source-specific patterns if configured
	if len(cond.SourcePatterns) > 0 {
		pattern, hasPattern := cond.SourcePatterns[source.Source]
		if hasPattern && pattern != "" {
			// Source pattern must match the external ID
			if !matchSourcePattern(source.ExternalID, pattern) {
				return 0, false
			}
		}
	}

	// P2 Fix: Special handling for source+externalId exact matching
	// Check if the condition requires matching source and externalId
	hasSourceField := false
	hasExternalIdField := false
	for _, field := range cond.ExactFields {
		if field == "source" {
			hasSourceField = true
		}
		if field == "externalId" {
			hasExternalIdField = true
		}
	}

	// If matching source/externalId, use entityHasSourceRef which checks ALL refs
	if hasSourceField || hasExternalIdField {
		sourceToMatch := ""
		externalIdToMatch := ""
		if hasSourceField {
			sourceToMatch = source.Source
		}
		if hasExternalIdField {
			externalIdToMatch = source.ExternalID
		}
		if !entityHasSourceRef(candidate, sourceToMatch, externalIdToMatch) {
			return 0, false
		}
	}

	// Check other exact field matches (excluding source/externalId which are handled above)
	for _, field := range cond.ExactFields {
		if field == "source" || field == "externalId" {
			continue // Already handled above
		}
		sourceVal := getFieldValue(source, field)
		candidateVal := getEntityFieldValue(candidate, field)
		if sourceVal == "" || candidateVal == "" {
			return 0, false
		}
		if !strings.EqualFold(sourceVal, candidateVal) {
			return 0, false
		}
	}

	// If only exact fields and they all matched
	if len(cond.ExactFields) > 0 && cond.FuzzyNameThreshold <= 0 {
		return 1.0, true
	}

	// Check fuzzy name match
	if cond.FuzzyNameThreshold > 0 {
		nameScore := fuzzyNameScore(source.Name, candidate.Name)
		
		// Also check aliases
		for _, alias := range candidate.Aliases {
			aliasScore := fuzzyNameScore(source.Name, alias)
			if aliasScore > nameScore {
				nameScore = aliasScore
			}
		}

		if nameScore < cond.FuzzyNameThreshold {
			return 0, false
		}

		// Check required qualifiers
		for _, q := range cond.RequiredQualifiers {
			sourceQual := source.Qualifiers[q]
			candQual := candidate.Qualifiers[q]
			if sourceQual != "" && candQual != "" && !strings.EqualFold(sourceQual, candQual) {
				return 0, false // Qualifiers conflict
			}
		}

		return nameScore, true
	}

	return 0, false
}

// matchSourcePattern checks if an ID matches a pattern.
// Supports simple wildcard patterns: * matches any sequence.
func matchSourcePattern(id, pattern string) bool {
	if pattern == "" || pattern == "*" {
		return true
	}
	
	// Simple wildcard matching
	if strings.Contains(pattern, "*") {
		parts := strings.Split(pattern, "*")
		pos := 0
		for i, part := range parts {
			if part == "" {
				continue
			}
			idx := strings.Index(id[pos:], part)
			if idx < 0 {
				return false
			}
			if i == 0 && !strings.HasPrefix(pattern, "*") && idx != 0 {
				return false
			}
			pos += idx + len(part)
		}
		if !strings.HasSuffix(pattern, "*") && pos != len(id) {
			return false
		}
		return true
	}

	// Exact match if no wildcards
	return id == pattern
}

// ===================================================
// Helper Functions
// ===================================================

// generateCanonicalID creates a unique canonical entity ID.
func generateCanonicalID(source SourceEntity) string {
	return fmt.Sprintf("entity:%s:%s", source.Type, uuid.New().String()[:8])
}

// extractNamePrefix gets first word for filtering.
func extractNamePrefix(name string) string {
	parts := strings.Fields(name)
	if len(parts) > 0 {
		return parts[0]
	}
	return name
}

// fuzzyNameScore calculates similarity between two names.
func fuzzyNameScore(a, b string) float32 {
	a = strings.ToLower(strings.TrimSpace(a))
	b = strings.ToLower(strings.TrimSpace(b))

	if a == b {
		return 1.0
	}

	// Jaro-Winkler would be ideal here; using simple containment for now
	if strings.Contains(a, b) || strings.Contains(b, a) {
		shorter := len(a)
		longer := len(b)
		if shorter > longer {
			shorter, longer = longer, shorter
		}
		return float32(shorter) / float32(longer)
	}

	// Token-based overlap
	aTokens := strings.Fields(a)
	bTokens := strings.Fields(b)
	
	matches := 0
	for _, at := range aTokens {
		for _, bt := range bTokens {
			if at == bt {
				matches++
				break
			}
		}
	}

	total := len(aTokens) + len(bTokens)
	if total == 0 {
		return 0
	}
	return float32(matches*2) / float32(total)
}

// getFieldValue extracts a field value from SourceEntity.
func getFieldValue(source SourceEntity, field string) string {
	switch field {
	case "email":
		return source.Email
	case "source":
		return source.Source
	case "externalId":
		return source.ExternalID
	case "type":
		return source.Type
	case "name":
		return source.Name
	default:
		if v, ok := source.Properties[field].(string); ok {
			return v
		}
		if v, ok := source.Qualifiers[field]; ok {
			return v
		}
		return ""
	}
}

// getEntityFieldValue extracts a field value from CanonicalEntity.
// P2 Fix: For source/externalId, returns a match if ANY source ref matches the given source.
func getEntityFieldValue(entity *CanonicalEntity, field string) string {
	switch field {
	case "type":
		return entity.Type
	case "name":
		return entity.Name
	case "source":
		// Return first source (for display purposes)
		// Actual matching should use entityHasSourceRef
		if len(entity.SourceRefs) > 0 {
			return entity.SourceRefs[0].Source
		}
		return ""
	case "externalId":
		// Return first externalId (for display purposes)
		if len(entity.SourceRefs) > 0 {
			return entity.SourceRefs[0].ExternalID
		}
		return ""
	default:
		if v, ok := entity.Properties[field].(string); ok {
			return v
		}
		if v, ok := entity.Qualifiers[field]; ok {
			return v
		}
		return ""
	}
}

// entityHasSourceRef checks if an entity has a matching source reference.
// P2 Fix: Checks ALL source refs, not just the first one.
func entityHasSourceRef(entity *CanonicalEntity, source, externalID string) bool {
	for _, ref := range entity.SourceRefs {
		sourceMatch := source == "" || strings.EqualFold(ref.Source, source)
		idMatch := externalID == "" || strings.EqualFold(ref.ExternalID, externalID)
		if sourceMatch && idMatch {
			return true
		}
	}
	return false
}

// mergeProperties merges two property maps.
func mergeProperties(existing, new map[string]any) map[string]any {
	if existing == nil {
		existing = make(map[string]any)
	}
	for k, v := range new {
		if _, exists := existing[k]; !exists {
			existing[k] = v
		}
	}
	return existing
}

// deduplicateCandidates removes duplicate entities by ID.
func deduplicateCandidates(candidates []*CanonicalEntity) []*CanonicalEntity {
	seen := make(map[string]bool)
	var result []*CanonicalEntity
	for _, c := range candidates {
		if !seen[c.ID] {
			seen[c.ID] = true
			result = append(result, c)
		}
	}
	return result
}

// sortMatchResults sorts by score descending.
func sortMatchResults(results []MatchResult) {
	// Simple bubble sort for small slices
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Score > results[i].Score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}
}

// Ensure interface compliance
var _ EntityMatcher = (*DefaultEntityMatcher)(nil)
