// Package core provides shared data models for UCL.
package core

import "time"

// =============================================================================
// METADATA TARGET & CONTEXT
// =============================================================================

// MetadataTarget identifies a specific metadata subject.
type MetadataTarget struct {
	SourceID  string         // Source system identifier
	Namespace string         // Optional namespace/schema
	Entity    string         // Optional entity/table name
	Extras    map[string]any // Additional context
}

// MetadataContext provides execution context for metadata operations.
type MetadataContext struct {
	SourceID  string
	JobID     string
	RunID     string
	Namespace string
	Extras    map[string]any
}

// =============================================================================
// METADATA RECORD
// =============================================================================

// MetadataRecord is the core unit of metadata exchange.
type MetadataRecord struct {
	Target     MetadataTarget
	Kind       string         // Record type (schema, stats, catalog, etc.)
	Payload    any            // The actual metadata content
	ProducedAt time.Time
	ProducerID string
	Version    string
	Quality    map[string]any // Quality metrics
	Extras     map[string]any
}

// MetadataQuery specifies criteria for querying metadata.
type MetadataQuery struct {
	Target         *MetadataTarget
	Kinds          []string
	IncludeHistory bool
	Limit          int
	Filters        map[string]any
}

// =============================================================================
// METADATA REQUEST/RESPONSE
// =============================================================================

// MetadataRequest triggers metadata collection.
type MetadataRequest struct {
	Target   MetadataTarget
	Artifact map[string]any
	Context  MetadataContext
	Refresh  bool
	Config   map[string]any
}

// MetadataConfigValidationResult reports config validation outcome.
type MetadataConfigValidationResult struct {
	OK                   bool
	Errors               []string
	Warnings             []string
	NormalizedParameters map[string]any
	Success              bool
	Message              string
	Details              map[string]any
}

// MetadataPlanningResult contains planned metadata jobs.
type MetadataPlanningResult struct {
	Jobs     []*MetadataJob
	Success  bool
	Message  string
	Details  map[string]any
	// CleanupCallbacks omitted - Go uses defer pattern instead
}

// MetadataJob represents a single metadata collection job.
type MetadataJob struct {
	Endpoint any
	Target   MetadataTarget
	Artifact map[string]any
}

// =============================================================================
// CATALOG/DATASET MODELS
// =============================================================================

// DataSourceMetadata describes a physical or logical data source.
type DataSourceMetadata struct {
	ID          string
	Name        string
	Type        string // oracle, snowflake, s3, etc.
	System      string // hostname, account, cluster
	Environment string // prod, staging, region
	Version     string
	Description string
	Tags        map[string]any
	Properties  map[string]any
	Extras      map[string]any
}

// DatasetMetadata represents a dataset/table/view.
type DatasetMetadata struct {
	ID           string
	Name         string
	PhysicalName string
	Type         string // table, view, stream, file, topic
	SourceID     string
	Location     string // path, database.schema, bucket/key
	Description  string
	Tags         map[string]any
	Properties   map[string]any
	Extras       map[string]any
}

// SchemaFieldStatistics contains column-level profiling stats.
type SchemaFieldStatistics struct {
	NullCount     int64
	DistinctCount int64
	MinValue      any
	MaxValue      any
	AvgLength     float64
	MinLength     int
	MaxLength     int
	Histogram     any
	Density       any
	LastAnalyzed  any
	Extras        map[string]any
}

// DatasetStatistics contains table-level statistics.
type DatasetStatistics struct {
	RowCount          int64
	SizeBytes         int64
	LastAnalyzedAt    string
	Stale             bool
	Blocks            int
	Partitions        int
	StorageBlocks     int
	AverageRecordSize int
	SampleSize        int
	LastProfiledAt    string
	Extras            map[string]any
}

// DatasetConstraintField represents a field in a constraint.
type DatasetConstraintField struct {
	Name     string
	Position int
}

// DatasetConstraint represents PK/FK/unique constraints.
type DatasetConstraint struct {
	Name                 string
	Type                 string // primary_key, foreign_key, unique, check
	Fields               []DatasetConstraintField
	ReferencedTable      string
	ReferencedFields     []string
	Definition           string
	Status               string
	Deferrable           bool
	Deferred             bool
	Validated            bool
	Generated            string
	DeleteRule           string
	ReferencedConstraint string
	Extras               map[string]any
}

// CatalogSnapshot captures a point-in-time view of catalog metadata.
type CatalogSnapshot struct {
	Source      string
	Schema      string
	Table       string
	Name        string
	CollectedAt string
	Version     string
	Fields      []*SchemaField
	Statistics  *DatasetStatistics
	Constraints []*DatasetConstraint
	DataSource  *DataSourceMetadata
	Dataset     *DatasetMetadata
	RawVendor   map[string]any
	Extras      map[string]any
}

// SchemaField represents a column definition (alias for readability).
type SchemaField struct {
	Name       string
	DataType   string
	Nullable   bool
	Precision  int
	Scale      int
	Length     int
	Default    any
	Comment    string
	Position   int
	Statistics *SchemaFieldStatistics
	Extras     map[string]any
}
