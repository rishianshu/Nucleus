package activities

import internal "github.com/nucleus/ucl-worker/internal/activities"

// NewActivities re-exports the internal activities constructor for external workers.
func NewActivities() *internal.Activities {
	return internal.NewActivities()
}
