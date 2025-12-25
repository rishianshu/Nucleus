package endpoint

import (
	"context"
	"reflect"
	"time"
)

// DefaultRelationEventProcessor implements SCD2-style temporal tracking for relations.
// Detects new, expired, and reassigned relations by comparing current vs previous state.
type DefaultRelationEventProcessor struct {
	// SingleAssignmentTypes lists relation types that can only have one target per source.
	// For these types, a change in ToRef triggers a REASSIGN event.
	// Example: ASSIGNED_TO (an issue can only have one assignee at a time)
	SingleAssignmentTypes map[string]bool
}

// NewRelationEventProcessor creates a new default relation event processor.
func NewRelationEventProcessor() *DefaultRelationEventProcessor {
	return &DefaultRelationEventProcessor{
		SingleAssignmentTypes: map[string]bool{
			"ASSIGNED_TO": true,
			"REPORTED_BY": true,
			"OWNED_BY":    true,
			"CREATED_BY":  true,
			"UPDATED_BY":  true,
			"MERGED_BY":   true,
		},
	}
}

// ProcessRelations compares current relations against previous state and emits events.
// Implements SCD2 pattern: detects created, expired, and reassigned relations.
//
// Design:
// - Single-assignment types (ASSIGNED_TO): keyed by FromRef|Type to detect reassignment
// - Multi-target types (MENTIONS): keyed by full EdgeKey (FromRef|ToRef|Type)
//
// This hybrid approach correctly handles both:
// - Issue reassignment: ASSIGNED_TO A->B triggers REASSIGN event
// - Multiple mentions: MENTIONS A,B,C tracked individually
func (p *DefaultRelationEventProcessor) ProcessRelations(
	_ context.Context, // P0 Fix: Mark as unused (Go allows this for interface compliance)
	_ string,          // entityRef - available for future use
	previousRelations []Relation,
	currentRelations []Relation,
	timestamp time.Time,
) ([]RelationEvent, error) {
	var events []RelationEvent

	// Build maps of previous relations
	// singlePrev: FromRef|Type -> Relation (for single-assignment types)
	// multiPrev: FromRef|ToRef|Type -> Relation (for multi-target types)
	singlePrev := make(map[string]Relation)
	multiPrev := make(map[string]Relation)

	for _, r := range previousRelations {
		if p.isSingleAssignment(r.Type) {
			key := r.FromRef + "|" + r.Type
			singlePrev[key] = r
		} else {
			key := EdgeKey{FromRef: r.FromRef, ToRef: r.ToRef, Type: r.Type}.Key()
			multiPrev[key] = r
		}
	}

	// Track which previous relations are still present
	seenSingleKeys := make(map[string]bool)
	seenMultiKeys := make(map[string]bool)

	// Process current relations
	for _, curr := range currentRelations {
		if p.isSingleAssignment(curr.Type) {
			events = append(events, p.processSingleAssignment(
				curr, singlePrev, seenSingleKeys, timestamp,
			)...)
		} else {
			events = append(events, p.processMultiTarget(
				curr, multiPrev, seenMultiKeys, timestamp,
			)...)
		}
	}

	// Find expired relations (in previous but not seen in current)
	for _, prev := range previousRelations {
		var key string
		var seen bool

		if p.isSingleAssignment(prev.Type) {
			key = prev.FromRef + "|" + prev.Type
			seen = seenSingleKeys[key]
		} else {
			key = EdgeKey{FromRef: prev.FromRef, ToRef: prev.ToRef, Type: prev.Type}.Key()
			seen = seenMultiKeys[key]
		}

		if !seen {
			expiredTime := timestamp
			prev.ValidTo = &expiredTime
			events = append(events, RelationEvent{
				EventType: RelationEventExpired,
				Relation:  prev,
				Timestamp: timestamp,
			})
		}
	}

	return events, nil
}

// isSingleAssignment checks if a relation type allows only one target per source.
func (p *DefaultRelationEventProcessor) isSingleAssignment(relType string) bool {
	return p.SingleAssignmentTypes[relType]
}

// processSingleAssignment handles single-assignment relations where ToRef change = reassign.
func (p *DefaultRelationEventProcessor) processSingleAssignment(
	curr Relation,
	prevMap map[string]Relation,
	seenKeys map[string]bool,
	timestamp time.Time,
) []RelationEvent {
	key := curr.FromRef + "|" + curr.Type
	prev, existed := prevMap[key]

	if !existed {
		// New relation created
		curr.ValidFrom = &timestamp
		return []RelationEvent{{
			EventType: RelationEventCreated,
			Relation:  curr,
			Timestamp: timestamp,
		}}
	}

	seenKeys[key] = true

	if prev.ToRef != curr.ToRef {
		// Reassignment: target changed (A -> B)
		expiredTime := timestamp
		prev.ValidTo = &expiredTime
		curr.ValidFrom = &timestamp
		return []RelationEvent{{
			EventType:  RelationEventReassign,
			Relation:   curr,
			PreviousTo: prev.ToRef,
			Timestamp:  timestamp,
			Metadata: map[string]any{
				"expired_relation": prev,
			},
		}}
	}

	if !propertiesEqual(prev.Properties, curr.Properties) {
		// Same target, but properties changed
		// P1 Fix: Close previous version for complete SCD2 versioning
		prev.ValidTo = &timestamp
		curr.ValidFrom = &timestamp
		return []RelationEvent{{
			EventType: RelationEventUpdated,
			Relation:  curr,
			Timestamp: timestamp,
			Metadata: map[string]any{
				"previous_properties": prev.Properties,
				"previous_relation":   prev,
			},
		}}
	}

	// No change
	return nil
}

// processMultiTarget handles multi-target relations tracked by full EdgeKey.
func (p *DefaultRelationEventProcessor) processMultiTarget(
	curr Relation,
	prevMap map[string]Relation,
	seenKeys map[string]bool,
	timestamp time.Time,
) []RelationEvent {
	key := EdgeKey{FromRef: curr.FromRef, ToRef: curr.ToRef, Type: curr.Type}.Key()
	prev, existed := prevMap[key]

	if !existed {
		// New relation created
		curr.ValidFrom = &timestamp
		return []RelationEvent{{
			EventType: RelationEventCreated,
			Relation:  curr,
			Timestamp: timestamp,
		}}
	}

	seenKeys[key] = true

	if !propertiesEqual(prev.Properties, curr.Properties) {
		// Same edge, but properties changed
		// P1 Fix: Close previous version for complete SCD2 versioning
		prev.ValidTo = &timestamp
		curr.ValidFrom = &timestamp
		return []RelationEvent{{
			EventType: RelationEventUpdated,
			Relation:  curr,
			Timestamp: timestamp,
			Metadata: map[string]any{
				"previous_properties": prev.Properties,
				"previous_relation":   prev,
			},
		}}
	}

	// No change
	return nil
}

// propertiesEqual compares two property maps for deep equality.
// P1 Fix: Uses reflect.DeepEqual to safely compare slices, maps, and other non-comparable types.
func propertiesEqual(a, b map[string]any) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		bv, ok := b[k]
		if !ok {
			return false
		}
		// Use DeepEqual to safely compare any types including slices/maps
		if !deepEqual(v, bv) {
			return false
		}
	}
	return true
}

// deepEqual safely compares two values, handling non-comparable types.
// Falls back to reflect.DeepEqual for complex types.
func deepEqual(a, b any) bool {
	// Fast path for nil
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	// Try direct comparison for comparable types (strings, numbers, etc.)
	// This avoids reflect overhead for common cases
	defer func() {
		// Recover from panic if types are not comparable
		recover()
	}()

	// For simple comparable types, direct comparison is faster
	switch av := a.(type) {
	case string:
		if bv, ok := b.(string); ok {
			return av == bv
		}
		return false
	case int, int64, float64, bool:
		return a == b
	}

	// Fall back to reflect.DeepEqual for complex types
	return reflectDeepEqual(a, b)
}

// reflectDeepEqual wraps reflect.DeepEqual.
func reflectDeepEqual(a, b any) bool {
	return reflect.DeepEqual(a, b)
}

// Ensure interface compliance
var _ RelationEventProcessor = (*DefaultRelationEventProcessor)(nil)
