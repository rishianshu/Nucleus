package endpoint

import (
	"context"

	"github.com/nucleus/ucl-core/internal/core"
)

// --- Capability Traits ---
// These interfaces allow endpoints to declare additional capabilities
// beyond the base Source/Sink contracts.

// MetadataCapable endpoints can run catalog collectors.
type MetadataCapable interface {
	// ProbeEnvironment gathers server/version/context data.
	ProbeEnvironment(ctx context.Context, config map[string]any) (*Environment, error)

	// CollectMetadata produces dataset manifests for the catalog.
	CollectMetadata(ctx context.Context, env *Environment) (*CatalogSnapshot, error)
}

// IncrementalCapable endpoints support incremental reads.
type IncrementalCapable interface {
	// GetCheckpoint returns the last known checkpoint for a dataset.
	GetCheckpoint(ctx context.Context, datasetID string) (*Checkpoint, error)
}

// SliceCapable endpoints can plan adaptive slices for parallel reads.
type SliceCapable interface {
	IncrementalCapable

	// PlanSlices creates an ingestion plan with bounded slices.
	PlanSlices(ctx context.Context, req *PlanRequest) (*IngestionPlan, error)

	// ReadSlice reads records within a bounded slice.
	ReadSlice(ctx context.Context, req *SliceReadRequest) (Iterator[Record], error)

	// CountBetween returns the row count between bounds.
	CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error)
}

// StagingCapable sinks support incremental staging.
type StagingCapable interface {
	// StageSlice stages a slice without committing.
	StageSlice(ctx context.Context, req *StageRequest) (*StageResult, error)

	// CommitIncremental commits all staged slices atomically.
	CommitIncremental(ctx context.Context, req *CommitRequest) (*CommitResult, error)
}

// --- Supporting Types ---

type Environment struct {
	Version    string
	Properties map[string]any
}

type CatalogSnapshot = core.CatalogSnapshot
type DataSourceMetadata = core.DataSourceMetadata
type DatasetMetadata = core.DatasetMetadata


type Checkpoint struct {
	Watermark      string
	LastLoadedDate string
	Metadata       map[string]any
}

type PlanRequest struct {
	DatasetID       string
	Strategy        string // "full", "adaptive", "incremental"
	Checkpoint      *Checkpoint
	TargetSliceSize int64
}

type IngestionPlan struct {
	DatasetID  string
	Strategy   string
	Slices     []*IngestionSlice
	Statistics map[string]any
}

type SliceReadRequest struct {
	DatasetID string
	Slice     *IngestionSlice
}

type StageRequest struct {
	DatasetID string
	Context   *IncrementalContext
	Slice     *IngestionSlice
	Records   []Record
}

type IncrementalContext struct {
	Schema             string
	Table              string
	LoadDate           string
	IncrementalColumn  string
	IncrementalType    string
	PrimaryKeys        []string
	EffectiveWatermark string
	LastWatermark      string
}

type StageResult struct {
	Path    string
	Rows    int64
	Skipped bool
}

type CommitRequest struct {
	DatasetID    string
	Context      *IncrementalContext
	StagedSlices []*StageResult
}

type CommitResult struct {
	Rows         int64
	RawPath      string
	NewWatermark string
}
