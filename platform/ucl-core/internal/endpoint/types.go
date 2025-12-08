package endpoint

// Record represents a single data record as key-value pairs.
type Record = map[string]any

// Iterator provides streaming access to records.
type Iterator[T any] interface {
	// Next advances to the next record. Returns false when done or on error.
	Next() bool

	// Value returns the current record. Only valid after Next() returns true.
	Value() T

	// Err returns any error encountered during iteration.
	Err() error

	// Close releases resources. Must be called when done.
	Close() error
}

// --- Validation Types ---

type ValidationResult struct {
	Valid           bool
	Message         string
	DetectedVersion string
}

// --- Capabilities ---

type Capabilities struct {
	// Source capabilities
	SupportsFull        bool
	SupportsIncremental bool
	SupportsCountProbe  bool
	SupportsPreview     bool
	SupportsMetadata    bool

	// Sink capabilities
	SupportsWrite    bool
	SupportsFinalize bool
	SupportsPublish  bool
	SupportsWatermark bool
	SupportsStaging  bool
	SupportsMerge    bool

	// Incremental details
	IncrementalLiteral string // "timestamp" | "epoch"
	DefaultFetchSize   int
}

// --- Dataset Types ---

type Dataset struct {
	ID                  string
	Name                string
	Kind                string // "table", "view", "stream", "topic"
	SupportsIncremental bool
	CdmModelID          string // e.g., "cdm.work.item"
	IngestionStrategy   string // "full", "scd1", "cdc"
	IncrementalColumn   string
	IncrementalLiteral  string // "timestamp", "epoch"
	PrimaryKeys         []string
}

// SemanticUnit extends Dataset with semantic source metadata.
// Used by Jira, Confluence, OneDrive, etc.
type SemanticUnit struct {
	Dataset // Embedded dataset

	// Semantic source metadata
	UnitID      string         // e.g., projectKey, spaceKey, driveId
	UnitKind    string         // "project", "space", "drive", "folder"
	DisplayName string         // Human-readable name
	Stats       *UnitStats     // Runtime statistics
	CDMDomains  []string       // Declared emit domains
}

// UnitStats holds runtime statistics for a semantic unit.
type UnitStats struct {
	ItemCount     int64
	LastUpdatedAt string
	ErrorCount    int
}

// --- Schema Types ---

type Schema struct {
	Fields      []*FieldDefinition
	Constraints []*Constraint
	Statistics  *DatasetStatistics
}

type FieldDefinition struct {
	Name       string
	DataType   string
	Nullable   bool
	Precision  int
	Scale      int
	Length     int
	Comment    string
	Position   int
	Statistics *FieldStatistics
}

type FieldStatistics struct {
	NullCount     int64
	DistinctCount int64
	MinValue      string
	MaxValue      string
}

type Constraint struct {
	Name             string
	Type             string // "primary_key", "foreign_key", "unique", "check"
	Fields           []string
	ReferencedTable  string
	ReferencedFields []string
}

type DatasetStatistics struct {
	RowCount       int64
	SizeBytes      int64
	Partitions     int
	LastAnalyzedAt string
}

// --- Read Types ---

type ReadRequest struct {
	DatasetID string
	Limit     int64
	Slice     *IngestionSlice
}

type IngestionSlice struct {
	SliceID       string
	Sequence      int
	Lower         string
	Upper         string
	EstimatedRows int64
	Params        map[string]any
}

// --- Write Types ---

type WriteRequest struct {
	DatasetID string
	Mode      string // "append", "overwrite"
	LoadDate  string
	Records   []Record
}

type WriteResult struct {
	RowsWritten int64
	Path        string
}

type FinalizeResult struct {
	FinalPath string
}

// --- Action Types ---

type ActionDescriptor struct {
	ID           string             // Unique action ID
	Name         string             // Human-readable name
	Description  string             // What the action does
	Category     string             // "create", "update", "delete", "execute"
	RequiresAuth bool               // Whether action requires authenticated user
	Tags         []string           // Action tags for filtering
	Parameters   []*FieldDescriptor // Deprecated: use ActionSchema.InputFields
}

type ActionSchema struct {
	ActionID     string
	InputFields  []*ActionField
	OutputFields []*ActionField
}

type ActionField struct {
	Name        string
	Label       string
	DataType    string
	Required    bool
	Default     any
	Description string
	Enum        []string
}

type ActionRequest struct {
	ActionID   string
	Parameters map[string]any
	DryRun     bool
	Context    *ActionContext
}

type ActionContext struct {
	UserID    string
	RequestID string
	Timeout   int
	Metadata  map[string]any
}

type ActionResult struct {
	Success  bool
	Message  string
	Data     map[string]any
	Errors   []ActionError
	Warnings []string
}

type ActionError struct {
	Code    string
	Field   string
	Message string
}
