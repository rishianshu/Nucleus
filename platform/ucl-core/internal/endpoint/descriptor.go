package endpoint

// Descriptor provides metadata about an endpoint type.
// Used by UI/GraphQL for rendering configuration forms.
type Descriptor struct {
	ID           string
	Family       string
	Title        string
	Vendor       string
	Description  string
	Categories   []string
	Protocols    []string
	DefaultPort  int
	Driver       string
	DocsURL      string
	Fields       []*FieldDescriptor
	Capabilities []*CapabilityDescriptor
	SampleConfig map[string]any
}

// FieldDescriptor defines a configuration field.
type FieldDescriptor struct {
	Key          string
	Label        string
	ValueType    string // "string", "integer", "boolean", "password"
	Required     bool
	Semantic     string // "GENERIC", "HOST", "PORT", "PASSWORD", "FILE_PATH"
	Description  string
	Placeholder  string
	DefaultValue string
	Advanced     bool
	Sensitive    bool
	Options      []*FieldOption
	VisibleWhen  *VisibilityCondition
}

// FieldOption represents an enum option for a field.
type FieldOption struct {
	Label string
	Value string
}

// VisibilityCondition controls field visibility based on other field values.
type VisibilityCondition struct {
	Field    string
	Operator string // "eq", "ne", "in"
	Value    any
}

// CapabilityDescriptor describes a capability for UI/docs.
type CapabilityDescriptor struct {
	Key         string
	Label       string
	Description string
}
