// Package temporal provides Temporal workflow definitions.
package temporal

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// =============================================================================
// WORKFLOW NAMES
// =============================================================================

const (
	CollectionRunWorkflow           = "collectionRunWorkflow"
	ListEndpointTemplatesWorkflow   = "listEndpointTemplatesWorkflow"
	BuildEndpointConfigWorkflow     = "buildEndpointConfigWorkflow"
	TestEndpointConnectionWorkflow  = "testEndpointConnectionWorkflow"
	PreviewDatasetWorkflow          = "previewDatasetWorkflow"
	IngestionRunWorkflow            = "ingestionRunWorkflow"
)

// =============================================================================
// ACTIVITY OPTIONS
// =============================================================================

var defaultActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: time.Hour,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    time.Minute,
		MaximumAttempts:    3,
	},
}

var goActivityOptions = workflow.ActivityOptions{
	TaskQueue:              "metadata-go",
	ScheduleToCloseTimeout: 2 * time.Hour,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    time.Second * 5,
		BackoffCoefficient: 2.0,
		MaximumInterval:    time.Minute * 5,
		MaximumAttempts:    3,
	},
}

// =============================================================================
// WORKFLOW INPUTS/OUTPUTS
// =============================================================================

// CollectionRunInput is the input for CollectionRunWorkflow.
type CollectionRunInput struct {
	RunID        string `json:"runId,omitempty"`
	EndpointID   string `json:"endpointId,omitempty"`
	CollectionID string `json:"collectionId,omitempty"`
}

// IngestionRunInput is the input for IngestionRunWorkflow.
type IngestionRunInput struct {
	EndpointID     string `json:"endpointId"`
	UnitID         string `json:"unitId"`
	SinkID         string `json:"sinkId,omitempty"`
	SinkEndpointID string `json:"sinkEndpointId,omitempty"`
}

// ListTemplatesInput is the input for ListEndpointTemplatesWorkflow.
type ListTemplatesInput struct {
	Family string `json:"family,omitempty"`
}

// BuildConfigInput is the input for BuildEndpointConfigWorkflow.
type BuildConfigInput struct {
	TemplateID string            `json:"templateId"`
	Parameters map[string]string `json:"parameters"`
	Extras     *BuildExtras      `json:"extras,omitempty"`
}

// BuildExtras contains optional extra data for build.
type BuildExtras struct {
	Labels []string `json:"labels,omitempty"`
}

// TestConnectionInput is the input for TestEndpointConnectionWorkflow.
type TestConnectionInput struct {
	TemplateID string            `json:"templateId"`
	Parameters map[string]string `json:"parameters"`
}

// PreviewInput is the input for PreviewDatasetWorkflow.
type PreviewInput struct {
	DatasetID     string         `json:"datasetId"`
	EndpointID    string         `json:"endpointId"`
	UnitID        string         `json:"unitId"`
	Schema        string         `json:"schema"`
	Table         string         `json:"table"`
	Limit         int            `json:"limit,omitempty"`
	TemplateID    string         `json:"templateId"`
	Parameters    map[string]any `json:"parameters,omitempty"`
	ConnectionURL string         `json:"connectionUrl,omitempty"`
}

// =============================================================================
// COLLECTION RUN WORKFLOW
// =============================================================================

// CollectionRunWorkflowFunc defines the collection run workflow.
func CollectionRunWorkflowFunc(ctx workflow.Context, input CollectionRunInput) error {
	logger := workflow.GetLogger(ctx)
	info := workflow.GetInfo(ctx)
	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions)

	// Step 1: Create run if not provided
	runID := input.RunID
	if runID == "" {
		if input.EndpointID == "" {
			return temporal.NewApplicationError("endpointId required when runId not provided", "INVALID_INPUT")
		}
		var createResult struct {
			RunID string `json:"runId"`
		}
		err := workflow.ExecuteActivity(actCtx, "CreateCollectionRun", map[string]any{
			"endpointId":   input.EndpointID,
			"collectionId": input.CollectionID,
			"reason":       "schedule",
		}).Get(ctx, &createResult)
		if err != nil {
			return err
		}
		runID = createResult.RunID
	}

	// Step 2: Mark run started
	err := workflow.ExecuteActivity(actCtx, "MarkRunStarted", map[string]any{
		"runId":         runID,
		"workflowId":    info.WorkflowExecution.ID,
		"temporalRunId": info.WorkflowExecution.RunID,
	}).Get(ctx, nil)
	if err != nil {
		return err
	}

	// Step 3: Prepare collection job
	var plan struct {
		Kind   string         `json:"kind"`
		Reason string         `json:"reason,omitempty"`
		Job    map[string]any `json:"job,omitempty"`
	}
	err = workflow.ExecuteActivity(actCtx, "PrepareCollectionJob", map[string]any{
		"runId": runID,
	}).Get(ctx, &plan)
	if err != nil {
		_ = workflow.ExecuteActivity(actCtx, "MarkRunFailed", map[string]any{
			"runId": runID,
			"error": err.Error(),
		}).Get(ctx, nil)
		return err
	}

	if plan.Kind == "skip" {
		logger.Info("collection skipped", "reason", plan.Reason)
		return workflow.ExecuteActivity(actCtx, "MarkRunSkipped", map[string]any{
			"runId":  runID,
			"reason": plan.Reason,
		}).Get(ctx, nil)
	}

	// Step 4: Execute collection via Go activities
	goCtx := workflow.WithActivityOptions(ctx, goActivityOptions)
	var result struct {
		Records     []map[string]any `json:"records,omitempty"`
		RecordsPath string           `json:"recordsPath,omitempty"`
	}
	err = workflow.ExecuteActivity(goCtx, "CollectCatalogSnapshots", plan.Job).Get(ctx, &result)
	if err != nil {
		_ = workflow.ExecuteActivity(actCtx, "MarkRunFailed", map[string]any{
			"runId": runID,
			"error": err.Error(),
		}).Get(ctx, nil)
		return err
	}

	// Step 5: Persist catalog records
	err = workflow.ExecuteActivity(actCtx, "PersistCatalogRecords", map[string]any{
		"runId":       runID,
		"records":     result.Records,
		"recordsPath": result.RecordsPath,
	}).Get(ctx, nil)
	if err != nil {
		_ = workflow.ExecuteActivity(actCtx, "MarkRunFailed", map[string]any{
			"runId": runID,
			"error": err.Error(),
		}).Get(ctx, nil)
		return err
	}

	// Step 6: Mark completed
	return workflow.ExecuteActivity(actCtx, "MarkRunCompleted", map[string]any{
		"runId": runID,
	}).Get(ctx, nil)
}

// =============================================================================
// LIST ENDPOINT TEMPLATES WORKFLOW
// =============================================================================

// ListEndpointTemplatesWorkflowFunc defines the list templates workflow.
func ListEndpointTemplatesWorkflowFunc(ctx workflow.Context, input ListTemplatesInput) ([]map[string]any, error) {
	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions)
	var templates []map[string]any
	err := workflow.ExecuteActivity(actCtx, "ListEndpointTemplates", input).Get(ctx, &templates)
	return templates, err
}

// =============================================================================
// BUILD ENDPOINT CONFIG WORKFLOW
// =============================================================================

// BuildEndpointConfigWorkflowFunc defines the build config workflow.
func BuildEndpointConfigWorkflowFunc(ctx workflow.Context, input BuildConfigInput) (map[string]any, error) {
	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions)
	var result map[string]any
	err := workflow.ExecuteActivity(actCtx, "BuildEndpointConfig", input).Get(ctx, &result)
	return result, err
}

// =============================================================================
// TEST ENDPOINT CONNECTION WORKFLOW
// =============================================================================

// TestEndpointConnectionWorkflowFunc defines the test connection workflow.
func TestEndpointConnectionWorkflowFunc(ctx workflow.Context, input TestConnectionInput) (map[string]any, error) {
	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions)
	var result map[string]any
	err := workflow.ExecuteActivity(actCtx, "TestEndpointConnection", input).Get(ctx, &result)
	if err != nil {
		return nil, temporal.NewNonRetryableApplicationError(err.Error(), "EndpointTestFailure", err)
	}
	return result, nil
}

// =============================================================================
// PREVIEW DATASET WORKFLOW
// =============================================================================

// PreviewDatasetWorkflowFunc defines the preview dataset workflow.
func PreviewDatasetWorkflowFunc(ctx workflow.Context, input PreviewInput) (map[string]any, error) {
	goCtx := workflow.WithActivityOptions(ctx, goActivityOptions)
	var preview struct {
		Rows      []map[string]any `json:"rows"`
		SampledAt string           `json:"sampledAt"`
	}
	err := workflow.ExecuteActivity(goCtx, "PreviewDataset", input).Get(ctx, &preview)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"rows":      preview.Rows,
		"sampledAt": preview.SampledAt,
	}, nil
}

// =============================================================================
// INGESTION RUN WORKFLOW
// =============================================================================

// IngestionRunWorkflowFunc defines the ingestion workflow.
func IngestionRunWorkflowFunc(ctx workflow.Context, input IngestionRunInput) error {
	logger := workflow.GetLogger(ctx)

	if input.EndpointID == "" || input.UnitID == "" {
		return temporal.NewApplicationError("endpointId and unitId are required", "INVALID_INPUT")
	}

	actCtx := workflow.WithActivityOptions(ctx, defaultActivityOptions)
	goCtx := workflow.WithActivityOptions(ctx, goActivityOptions)

	// Step 1: Start ingestion run
	var context struct {
		RunID             string         `json:"runId"`
		SinkID            string         `json:"sinkId"`
		VendorKey         string         `json:"vendorKey"`
		Checkpoint        map[string]any `json:"checkpoint"`
		CheckpointVersion string         `json:"checkpointVersion"`
		StagingProviderID string         `json:"stagingProviderId"`
		Policy            map[string]any `json:"policy"`
		Mode              string         `json:"mode"`
	}

	err := workflow.ExecuteActivity(actCtx, "StartIngestionRun", map[string]any{
		"endpointId": input.EndpointID,
		"unitId":     input.UnitID,
		"sinkId":     input.SinkID,
	}).Get(ctx, &context)
	if err != nil {
		return err
	}

	logger.Info("ingestion-started", "runId", context.RunID, "sinkId", context.SinkID)

	// Step 2: Plan ingestion
	var plan struct {
		Slices []map[string]any `json:"slices"`
	}
	err = workflow.ExecuteActivity(goCtx, "PlanIngestionUnit", map[string]any{
		"endpointId":        input.EndpointID,
		"unitId":            input.UnitID,
		"sinkId":            context.SinkID,
		"checkpoint":        context.Checkpoint,
		"stagingProviderId": context.StagingProviderID,
		"policy":            context.Policy,
		"mode":              context.Mode,
	}).Get(ctx, &plan)
	if err != nil {
		_ = workflow.ExecuteActivity(actCtx, "FailIngestionRun", map[string]any{
			"endpointId": input.EndpointID,
			"unitId":     input.UnitID,
			"sinkId":     context.SinkID,
			"vendorKey":  context.VendorKey,
			"runId":      context.RunID,
			"error":      err.Error(),
		}).Get(ctx, nil)
		return err
	}

	// Step 3: Execute slices
	slices := plan.Slices
	if len(slices) == 0 {
		slices = []map[string]any{{}}
	}

	var sliceResults []map[string]any
	for _, slice := range slices {
		var result map[string]any
		err = workflow.ExecuteActivity(goCtx, "RunIngestionUnit", map[string]any{
			"endpointId":        input.EndpointID,
			"unitId":            input.UnitID,
			"sinkId":            context.SinkID,
			"checkpoint":        context.Checkpoint,
			"stagingProviderId": context.StagingProviderID,
			"policy":            context.Policy,
			"mode":              context.Mode,
			"slice":             slice,
		}).Get(ctx, &result)
		if err != nil {
			_ = workflow.ExecuteActivity(actCtx, "FailIngestionRun", map[string]any{
				"endpointId": input.EndpointID,
				"unitId":     input.UnitID,
				"sinkId":     context.SinkID,
				"vendorKey":  context.VendorKey,
				"runId":      context.RunID,
				"error":      err.Error(),
			}).Get(ctx, nil)
			return err
		}
		sliceResults = append(sliceResults, result)
	}

	// Step 4: Complete run
	var newCheckpoint any
	if len(sliceResults) > 0 {
		newCheckpoint = sliceResults[len(sliceResults)-1]["newCheckpoint"]
	}

	return workflow.ExecuteActivity(actCtx, "CompleteIngestionRun", map[string]any{
		"endpointId":        input.EndpointID,
		"unitId":            input.UnitID,
		"sinkId":            context.SinkID,
		"vendorKey":         context.VendorKey,
		"runId":             context.RunID,
		"checkpointVersion": context.CheckpointVersion,
		"newCheckpoint":     newCheckpoint,
	}).Get(ctx, nil)
}
