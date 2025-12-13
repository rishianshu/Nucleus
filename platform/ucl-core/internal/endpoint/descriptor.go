package endpoint

// Descriptor provides metadata about an endpoint type.
// Used by UI/GraphQL for rendering configuration forms.
type Descriptor struct {
	ID            string
	Family        string
	Title         string
	Vendor        string
	Description   string
	Categories    []string
	Protocols     []string
	DefaultPort   int
	Driver        string
	DocsURL       string
	Domain        string
	AgentPrompt   string
	DefaultLabels []string
	Version       string
	MinVersion    string
	MaxVersion    string
	Fields        []*FieldDescriptor
	Capabilities  []*CapabilityDescriptor
	Connection    *ConnectionConfig
	Probing       *ProbingPlan
	SampleConfig  map[string]any
	Extras        map[string]any
	Auth          *AuthDescriptor
}

// ConnectionConfig defines connection parameters.
type ConnectionConfig struct {
	URLTemplate string `json:"url_template"`
	DefaultVerb string `json:"default_verb"`
}

// ProbingPlan defines how to probe the endpoint.
type ProbingPlan struct {
	Methods         []*ProbingMethod `json:"methods"`
	FallbackMessage string           `json:"fallback_message"`
}

// ProbingMethod defines a specific probing strategy.
type ProbingMethod struct {
	Key                 string   `json:"key"`
	Label               string   `json:"label"`
	Strategy            string   `json:"strategy"`
	Statement           string   `json:"statement"`
	Description         string   `json:"description"`
	Requires            []string `json:"requires"`
	ReturnsVersion      bool     `json:"returns_version"`
	ReturnsCapabilities []string `json:"returns_capabilities"`
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

	// Extended metadata
	Regex        string
	HelpText     string
	DependsOn    string
	DependsValue string
	MinValue     int64
	MaxValue     int64
}

// FieldOption represents an enum option for a field.
type FieldOption struct {
	Label       string
	Value       string
	Description string
}

// VisibilityCondition controls field visibility based on other field values.
type VisibilityCondition struct {
	Field    string
	Operator string // "eq", "ne", "in"
	Value    any
	Values   []string // For 'in' operator
}

// CapabilityDescriptor describes a capability for UI/docs.
type CapabilityDescriptor struct {
	Key         string
	Label       string
	Description string
}

// AuthDescriptor describes supported authentication flows.
type AuthDescriptor struct {
	Modes          []AuthModeDescriptor      `json:"modes"`
	ProfileBinding *ProfileBindingDescriptor `json:"profileBinding,omitempty"`
}

// AuthModeDescriptor enumerates a specific auth mode (service, delegated, etc.).
type AuthModeDescriptor struct {
	Mode           string   `json:"mode"`
	Label          string   `json:"label"`
	RequiredFields []string `json:"requiredFields,omitempty"`
	Scopes         []string `json:"scopes,omitempty"`
	Interactive    bool     `json:"interactive,omitempty"`
}

// ProfileBindingDescriptor signals whether user-profile binding is supported.
type ProfileBindingDescriptor struct {
	Supported      bool     `json:"supported"`
	PrincipalKinds []string `json:"principalKinds,omitempty"`
	Notes          string   `json:"notes,omitempty"`
}
