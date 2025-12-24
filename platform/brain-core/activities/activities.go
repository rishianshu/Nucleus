package activities

import internal "github.com/nucleus/brain-core/internal/activities"

// Activities re-exports the brain-core activities implementation.
type Activities = internal.Activities

// NewActivities returns the shared activities implementation.
func NewActivities() *Activities {
	return internal.NewActivities()
}

// Re-export common ingestion types for downstream workers.
type (
	CollectionJobRequest = internal.CollectionJobRequest
	CollectionResult     = internal.CollectionResult
	CatalogRecord        = internal.CatalogRecord
	LogEntry             = internal.LogEntry
	PreviewRequest       = internal.PreviewRequest
	PreviewResult        = internal.PreviewResult
	IngestionRequest     = internal.IngestionRequest
	IngestionResult      = internal.IngestionResult
	StagingHandle        = internal.StagingHandle
	PlanResult           = internal.PlanResult
	SliceDescriptor      = internal.SliceDescriptor
)
