package core

// =============================================================================
// SCHEMA DRIFT DETECTION
// Models for detecting and handling schema changes between runs.
// =============================================================================

// SchemaSnapshotColumn represents a column in a schema snapshot.
type SchemaSnapshotColumn struct {
	Name      string
	DataType  any
	Nullable  bool
	Precision any
	Scale     any
	Raw       any
}

// SchemaSnapshot captures point-in-time schema state for drift detection.
type SchemaSnapshot struct {
	Namespace   string
	Entity      string
	Columns     map[string]*SchemaSnapshotColumn
	Version     string
	CollectedAt any
	Raw         any
}

// SchemaDriftResult reports detected schema changes.
type SchemaDriftResult struct {
	Snapshot       *SchemaSnapshot
	NewColumns     []string
	MissingColumns []string
	TypeMismatches []*TypeMismatch
}

// TypeMismatch describes a column type change.
type TypeMismatch struct {
	Column   string
	Expected any
	Observed any
}

// SchemaDriftPolicy controls drift handling behavior.
type SchemaDriftPolicy struct {
	RequireSnapshot     bool
	AllowNewColumns     bool
	AllowMissingColumns bool
	AllowTypeMismatch   bool
}

// DefaultSchemaDriftPolicy returns the default permissive policy.
func DefaultSchemaDriftPolicy() *SchemaDriftPolicy {
	return &SchemaDriftPolicy{
		RequireSnapshot:     false,
		AllowNewColumns:     true,
		AllowMissingColumns: true,
		AllowTypeMismatch:   true,
	}
}

// Clone returns a copy with optional overrides.
func (p *SchemaDriftPolicy) Clone(overrides map[string]bool) *SchemaDriftPolicy {
	clone := *p
	if v, ok := overrides["requireSnapshot"]; ok {
		clone.RequireSnapshot = v
	}
	if v, ok := overrides["allowNewColumns"]; ok {
		clone.AllowNewColumns = v
	}
	if v, ok := overrides["allowMissingColumns"]; ok {
		clone.AllowMissingColumns = v
	}
	if v, ok := overrides["allowTypeMismatch"]; ok {
		clone.AllowTypeMismatch = v
	}
	return &clone
}

// SchemaValidationError is raised when drift violates policy.
type SchemaValidationError struct {
	Message string
	Result  *SchemaDriftResult
}

func (e *SchemaValidationError) Error() string {
	return e.Message
}
