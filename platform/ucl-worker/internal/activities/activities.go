// Package activities implements Temporal activities for UCL connectors.
package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-worker/internal/bridge"
	"github.com/nucleus/ucl-worker/internal/staging"
)

// Activities holds all UCL Temporal activities.
type Activities struct{}

// NewActivities creates a new Activities instance.
func NewActivities() *Activities {
	return &Activities{}
}

// =============================================================================
// ACTIVITY 1: CollectCatalogSnapshots
// =============================================================================

// CollectCatalogSnapshots fetches metadata catalog via UCL endpoint.
func (a *Activities) CollectCatalogSnapshots(ctx context.Context, req CollectionJobRequest) (*CollectionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("collecting catalog snapshots", "runId", req.RunID, "endpoint", req.EndpointName)

	// Resolve template and parameters
	templateID := resolveTemplateFromConfig(req.Config)
	if templateID == "" {
		return nil, fmt.Errorf("templateId not found in config")
	}

	params := resolveParamsFromConfig(req.Config)
	if req.ConnectionURL != "" {
		params["connectionUrl"] = req.ConnectionURL
		params["url"] = req.ConnectionURL
	}

	// Get UCL endpoint
	ep, err := bridge.GetSourceEndpoint(templateID, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	// List datasets
	datasets, err := ep.ListDatasets(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list datasets: %w", err)
	}

	// Build catalog records
	records := make([]CatalogRecord, 0, len(datasets))
	for _, ds := range datasets {
		schema, _ := ep.GetSchema(ctx, ds.ID)

		payload := map[string]any{
			"datasetId":            ds.ID,
			"name":                 ds.Name,
			"metadata_endpoint_id": req.EndpointID,
		}
		if schema != nil {
			payload["schema"] = schema
		}

		// Add metadata block
		payload["_metadata"] = map[string]any{
			"source_endpoint_id": req.EndpointID,
			"source_id":          req.SourceID,
		}

		labels := append([]string{}, req.Labels...)
		labels = append(labels, fmt.Sprintf("endpoint:%s", req.EndpointID))

		records = append(records, CatalogRecord{
			ID:        ds.ID,
			ProjectID: req.ProjectID,
			Domain:    "catalog.dataset",
			Labels:    labels,
			Payload:   payload,
		})
	}

	// Stage records to file
	recordsPath, err := staging.StageJSON(records, fmt.Sprintf("metadata-records-%s", req.RunID))
	if err != nil {
		return nil, fmt.Errorf("failed to stage records: %w", err)
	}

	logger.Info("catalog collection complete", "datasets", len(records))

	return &CollectionResult{
		RecordsPath: recordsPath,
		RecordCount: len(records),
		Logs: []LogEntry{
			{Level: "INFO", Message: fmt.Sprintf("collected %d datasets", len(records))},
		},
	}, nil
}

// =============================================================================
// ACTIVITY 2: PreviewDataset
// =============================================================================

// PreviewDataset samples rows from a dataset.
func (a *Activities) PreviewDataset(ctx context.Context, req PreviewRequest) (*PreviewResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("previewing dataset", "unitId", req.UnitID, "limit", req.Limit)

	// Get UCL endpoint
	ep, err := bridge.GetSourceEndpoint(req.TemplateID, req.Parameters)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	// Read with limit
	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}

	iter, err := ep.Read(ctx, &endpoint.ReadRequest{
		DatasetID: req.UnitID,
		Limit:     int64(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to read dataset: %w", err)
	}
	defer iter.Close()

	// Collect rows
	rows := make([]map[string]any, 0, limit)
	for iter.Next() {
		rows = append(rows, iter.Value())
		if len(rows) >= limit {
			break
		}
	}

	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("iteration error: %w", err)
	}

	sampledAt := time.Now().UTC().Format(time.RFC3339)

	// Check if response is too large
	data, _ := json.Marshal(rows)
	if len(data) > staging.MaxPayloadBytes {
		handle, err := staging.StageRecords(rows, req.StagingProviderID)
		if err != nil {
			return nil, fmt.Errorf("failed to stage preview: %w", err)
		}
		return &PreviewResult{
			Rows: []map[string]any{
				{"_preview": "staged", "rowCount": len(rows), "recordsPath": handle.Path},
			},
			SampledAt:         sampledAt,
			RecordsPath:       handle.Path,
			StagingProviderID: handle.ProviderID,
		}, nil
	}

	return &PreviewResult{
		Rows:      rows,
		SampledAt: sampledAt,
	}, nil
}

// =============================================================================
// ACTIVITY 3: PlanIngestionUnit
// =============================================================================

// PlanIngestionUnit creates slice plan for ingestion.
func (a *Activities) PlanIngestionUnit(ctx context.Context, req IngestionRequest) (*PlanResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("planning ingestion", "unitId", req.UnitID, "mode", req.Mode)

	templateID := bridge.ResolveTemplateID(req.Policy)
	if templateID == "" {
		return nil, fmt.Errorf("templateId is required for ingestion planning")
	}

	params := bridge.ResolveParameters(req.Policy)

	// Try to get SliceCapable endpoint
	sliceCapable, err := bridge.GetSliceCapableEndpoint(templateID, params)
	if err != nil {
		// Fallback: single slice for full sync
		logger.Warn("endpoint does not support slicing, using single slice", "error", err)
		return &PlanResult{
			Slices: []SliceDescriptor{
				{SliceKey: "full", Sequence: 0},
			},
			Strategy: "full",
		}, nil
	}

	// Create checkpoint from request
	var checkpoint *endpoint.Checkpoint
	if req.Checkpoint != nil {
		checkpoint = &endpoint.Checkpoint{
			Watermark: "",
			Metadata:  req.Checkpoint,
		}
		if wm, ok := req.Checkpoint["watermark"].(string); ok {
			checkpoint.Watermark = wm
		}
	}

	// Plan slices
	strategy := string(endpoint.StrategyFull)
	if strings.EqualFold(req.Mode, "incremental") {
		strategy = string(endpoint.StrategyIncremental)
	}

	plan, err := sliceCapable.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID:  req.UnitID,
		Strategy:   strategy,
		Checkpoint: checkpoint,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to plan slices: %w", err)
	}

	// Serialize slices
	slices := make([]SliceDescriptor, 0, len(plan.Slices))
	for i, s := range plan.Slices {
		slices = append(slices, SliceDescriptor{
			SliceKey: s.SliceID,
			Sequence: i,
			Lower:    s.Lower,
			Upper:    s.Upper,
		})
	}

	return &PlanResult{
		Slices:   slices,
		Strategy: string(strategy),
	}, nil
}

// =============================================================================
// ACTIVITY 4: RunIngestionUnit
// =============================================================================

// RunIngestionUnit executes ingestion for a unit/slice.
func (a *Activities) RunIngestionUnit(ctx context.Context, req IngestionRequest) (*IngestionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("running ingestion", "unitId", req.UnitID, "mode", req.Mode)

	templateID := bridge.ResolveTemplateID(req.Policy)
	if templateID == "" {
		return nil, fmt.Errorf("templateId is required for ingestion execution")
	}

	params := bridge.ResolveParameters(req.Policy)

	// Get endpoint
	ep, err := bridge.GetSourceEndpoint(templateID, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	var iter endpoint.Iterator[endpoint.Record]

	// Check if we have a slice to execute
	if req.Slice != nil {
		sliceCapable, ok := ep.(endpoint.SliceCapable)
		if !ok {
			return nil, fmt.Errorf("endpoint does not support slice operations")
		}

		slice := &endpoint.IngestionSlice{
			SliceID: getStringFromMap(req.Slice, "slice_key", "full"),
			Lower:   getStringFromMap(req.Slice, "lower", ""),
			Upper:   getStringFromMap(req.Slice, "upper", ""),
		}

		iter, err = sliceCapable.ReadSlice(ctx, &endpoint.SliceReadRequest{
			DatasetID: req.UnitID,
			Slice:     slice,
		})
	} else {
		// Full read
		iter, err = ep.Read(ctx, &endpoint.ReadRequest{
			DatasetID: req.UnitID,
		})
	}

	if err != nil {
		return nil, fmt.Errorf("failed to read data: %w", err)
	}
	defer iter.Close()

	// Collect records
	records := make([]map[string]any, 0)
	var recordCount int64

	for iter.Next() {
		records = append(records, iter.Value())
		recordCount++
	}

	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("iteration error: %w", err)
	}

	// Stage records
	var stagingHandles []StagingHandle
	var stagingPath string
	var stagingProviderID string

	if len(records) > 0 && strings.ToUpper(req.Mode) != "PREVIEW" {
		handle, err := staging.StageRecords(records, req.StagingProviderID)
		if err != nil {
			return nil, fmt.Errorf("failed to stage records: %w", err)
		}
		stagingHandles = append(stagingHandles, StagingHandle{
			Path:       handle.Path,
			ProviderID: handle.ProviderID,
		})
		stagingPath = handle.Path
		stagingProviderID = handle.ProviderID
	}

	// Build stats
	stats := map[string]any{
		"recordCount": recordCount,
		"unitId":      req.UnitID,
		"templateId":  templateID,
	}

	// Build checkpoint
	newCheckpoint := req.Checkpoint
	if newCheckpoint == nil {
		newCheckpoint = map[string]any{}
	}
	newCheckpoint["lastRunAt"] = time.Now().UTC().Format(time.RFC3339)
	newCheckpoint["recordCount"] = recordCount

	result := &IngestionResult{
		NewCheckpoint:     newCheckpoint,
		Stats:             stats,
		Staging:           stagingHandles,
		StagingPath:       stagingPath,
		StagingProviderID: stagingProviderID,
	}

	// Include records only in PREVIEW mode
	if strings.ToUpper(req.Mode) == "PREVIEW" {
		result.Records = records
	}

	logger.Info("ingestion complete", "records", recordCount)

	return result, nil
}

// =============================================================================
// HELPERS
// =============================================================================

func resolveTemplateFromConfig(config map[string]any) string {
	for _, key := range []string{"templateId", "template_id", "template"} {
		if v, ok := config[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func resolveParamsFromConfig(config map[string]any) map[string]any {
	if params, ok := config["parameters"].(map[string]any); ok {
		return params
	}
	// Clone config to avoid mutation
	result := make(map[string]any)
	for k, v := range config {
		result[k] = v
	}
	return result
}

func getStringFromMap(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}
