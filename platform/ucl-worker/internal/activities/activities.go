package activities

import brainactivities "github.com/nucleus/brain-core/activities"

// Activities aliases the shared brain-core activities (which include ingestion).
type Activities = brainactivities.Activities

// NewActivities returns the shared activities implementation.
func NewActivities() *Activities {
	return brainactivities.NewActivities()
}

// Re-export ingestion types for local helpers/tests.
type (
	CollectionJobRequest = brainactivities.CollectionJobRequest
	CollectionResult     = brainactivities.CollectionResult
	CatalogRecord        = brainactivities.CatalogRecord
	LogEntry             = brainactivities.LogEntry
	PreviewRequest       = brainactivities.PreviewRequest
	PreviewResult        = brainactivities.PreviewResult
	IngestionRequest     = brainactivities.IngestionRequest
	IngestionResult      = brainactivities.IngestionResult
	StagingHandle        = brainactivities.StagingHandle
	PlanResult           = brainactivities.PlanResult
	SliceDescriptor      = brainactivities.SliceDescriptor
)
