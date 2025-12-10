// Package activities implements Temporal activities for UCL connectors.
package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
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
	templateID := bridge.CanonicalTemplateID(resolveTemplateFromConfig(req.Config))
	if templateID == "" {
		return nil, fmt.Errorf("templateId not found in config")
	}

	params := bridge.NormalizeParameters(templateID, resolveParamsFromConfig(req.Config))
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

	// Normalize template/params to UCL expectations
	templateID := bridge.CanonicalTemplateID(req.TemplateID)
	params := bridge.NormalizeParameters(templateID, req.Parameters)

	// Get UCL endpoint
	ep, err := bridge.GetSourceEndpoint(templateID, params)
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

	// P3 Fix: Check if response is too large (configurable via UCL_MAX_PAYLOAD_BYTES env var)
	data, _ := json.Marshal(rows)
	maxPayloadBytes := getMaxPayloadBytes()
	if len(data) > maxPayloadBytes {
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

	params := bridge.NormalizeParameters(templateID, bridge.ResolveParameters(req.Policy))

	// P2 Fix: Extract target_slice_size from policy
	targetSliceSize := resolveTargetSliceSize(req.Policy)
	if targetSliceSize > 0 {
		logger.Info("using target slice size", "targetSliceSize", targetSliceSize)
	}

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
			PlanMetadata: map[string]any{
				"reason": "endpoint_not_slice_capable",
			},
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

	// P2 Fix: Pass target slice size to plan request
	plan, err := sliceCapable.PlanSlices(ctx, &endpoint.PlanRequest{
		DatasetID:       req.UnitID,
		Strategy:        strategy,
		Checkpoint:      checkpoint,
		TargetSliceSize: targetSliceSize,
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
			Params:   s.Params,
		})
	}

	// P2 Fix: Include plan metadata
	planMetadata := map[string]any{
		"datasetId":       req.UnitID,
		"templateId":      templateID,
		"sliceCount":      len(slices),
		"targetSliceSize": targetSliceSize,
	}
	if plan.Statistics != nil {
		planMetadata["statistics"] = plan.Statistics
	}

	return &PlanResult{
		Slices:       slices,
		Strategy:     string(strategy),
		PlanMetadata: planMetadata,
	}, nil
}

// =============================================================================
// ACTIVITY 4: RunIngestionUnit
// =============================================================================

// RunIngestionUnit executes ingestion for a unit/slice.
func (a *Activities) RunIngestionUnit(ctx context.Context, req IngestionRequest) (*IngestionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("running ingestion", "unitId", req.UnitID, "mode", req.Mode, "dataMode", req.DataMode)

	templateID := bridge.ResolveTemplateID(req.Policy)
	if templateID == "" {
		return nil, fmt.Errorf("templateId is required for ingestion execution")
	}

	params := bridge.NormalizeParameters(templateID, bridge.ResolveParameters(req.Policy))

	// Get endpoint
	ep, err := bridge.GetSourceEndpoint(templateID, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	// P1 Fix: Handle dataMode for checkpoint reset
	// dataMode "reset" means ignore existing checkpoint and start fresh
	checkpoint := req.Checkpoint
	if strings.EqualFold(req.DataMode, "reset") || strings.EqualFold(req.DataMode, "full") {
		logger.Info("dataMode requires checkpoint reset", "dataMode", req.DataMode)
		checkpoint = nil
	}

	var iter endpoint.Iterator[endpoint.Record]

	// Build read request with filter support (P1 Fix)
	readReq := &endpoint.ReadRequest{
		DatasetID:  req.UnitID,
		Checkpoint: checkpoint,
	}

	// P1 Fix: Pass filter to ReadRequest if supported
	if req.Filter != nil {
		readReq.Filter = req.Filter
		logger.Info("applying filter", "filter", req.Filter)
	}

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

		sliceReq := &endpoint.SliceReadRequest{
			DatasetID:  req.UnitID,
			Slice:      slice,
			Checkpoint: checkpoint,
			Filter:     req.Filter,
		}

		iter, err = sliceCapable.ReadSlice(ctx, sliceReq)
	} else {
		// Full read
		iter, err = ep.Read(ctx, readReq)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to read data: %w", err)
	}
	defer iter.Close()

	// CODEX FIX: Stream records in chunks to avoid buffering entire dataset in memory
	const chunkSize = 10000 // Stage every 10k records

	var stagingHandles []StagingHandle
	var stagingPath string
	var stagingProviderID string
	var recordCount int64
	var records []map[string]any
	isPreviewMode := strings.ToUpper(req.Mode) == "PREVIEW"

	for iter.Next() {
		record := iter.Value()
		records = append(records, record)
		recordCount++

		// In non-preview mode, stage records in chunks to limit memory usage
		if !isPreviewMode && len(records) >= chunkSize {
			handle, err := staging.StageRecords(records, req.StagingProviderID)
			if err != nil {
				return nil, fmt.Errorf("failed to stage records chunk: %w", err)
			}
			stagingHandles = append(stagingHandles, StagingHandle{
				Path:       handle.Path,
				ProviderID: handle.ProviderID,
			})
			if stagingPath == "" {
				stagingPath = handle.Path
				stagingProviderID = handle.ProviderID
			}
			// Clear records slice but keep capacity for reuse
			records = records[:0]
		}
	}

	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("iteration error: %w", err)
	}

	// Stage any remaining records
	if len(records) > 0 && !isPreviewMode {
		handle, err := staging.StageRecords(records, req.StagingProviderID)
		if err != nil {
			return nil, fmt.Errorf("failed to stage final records: %w", err)
		}
		stagingHandles = append(stagingHandles, StagingHandle{
			Path:       handle.Path,
			ProviderID: handle.ProviderID,
		})
		if stagingPath == "" {
			stagingPath = handle.Path
			stagingProviderID = handle.ProviderID
		}
	}

	// Build stats with more detail
	stats := map[string]any{
		"recordCount": recordCount,
		"unitId":      req.UnitID,
		"templateId":  templateID,
		"dataMode":    req.DataMode,
		"mode":        req.Mode,
	}

	// CODEX FIX: Build checkpoint with fallback to preserve incoming metadata
	// Start with incoming checkpoint to preserve prior metadata (per Python behavior)
	newCheckpoint := make(map[string]any)
	if req.Checkpoint != nil {
		// Copy incoming checkpoint as base (fallback behavior like Python)
		for k, v := range req.Checkpoint {
			newCheckpoint[k] = v
		}
	}
	
	// Override with iterator checkpoint if available (newer data takes precedence)
	if cp, ok := iter.(interface{ Checkpoint() *endpoint.Checkpoint }); ok {
		if iterCheckpoint := cp.Checkpoint(); iterCheckpoint != nil {
			newCheckpoint["watermark"] = iterCheckpoint.Watermark
			for k, v := range iterCheckpoint.Metadata {
				newCheckpoint[k] = v
			}
		}
	}
	
	// Always update these fields
	newCheckpoint["lastRunAt"] = time.Now().UTC().Format(time.RFC3339)
	newCheckpoint["recordCount"] = recordCount
	if req.DataMode != "" {
		newCheckpoint["dataMode"] = req.DataMode
	}

	// CODEX FIX: Forward transientState to result with run metadata
	// Python forwards transient_state from runner; we mirror input and add run details
	var resultTransientState map[string]any
	if req.TransientState != nil {
		resultTransientState = make(map[string]any)
		for k, v := range req.TransientState {
			resultTransientState[k] = v
		}
	} else {
		// Create new transient state if none provided
		resultTransientState = make(map[string]any)
	}
	// Add run metadata to transient state (like Python runner would)
	resultTransientState["lastProcessedAt"] = time.Now().UTC().Format(time.RFC3339)
	resultTransientState["recordsProcessed"] = recordCount
	resultTransientState["templateId"] = templateID
	resultTransientState["mode"] = req.Mode

	result := &IngestionResult{
		NewCheckpoint:     newCheckpoint,
		Stats:             stats,
		Staging:           stagingHandles,
		StagingPath:       stagingPath,
		StagingProviderID: stagingProviderID,
		TransientState:    resultTransientState, // P1 Fix: Forward transientState
	}

	// Include records only in PREVIEW mode
	if strings.ToUpper(req.Mode) == "PREVIEW" {
		result.Records = records
	}

	logger.Info("ingestion complete", "records", recordCount, "hasTransientState", resultTransientState != nil)

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

// P2 Fix: Resolve target_slice_size from policy
func resolveTargetSliceSize(policy map[string]any) int64 {
	if policy == nil {
		return 0
	}
	// Try various key formats
	for _, key := range []string{"target_slice_size", "targetSliceSize", "target_rows_per_slice", "targetRowsPerSlice"} {
		if v, ok := policy[key]; ok {
			switch val := v.(type) {
			case int:
				return int64(val)
			case int64:
				return val
			case float64:
				return int64(val)
			}
		}
	}
	// Try nested in parameters
	if params, ok := policy["parameters"].(map[string]any); ok {
		return resolveTargetSliceSize(params)
	}
	return 0
}

// P3 Fix: Get max payload bytes from env or default
func getMaxPayloadBytes() int {
	if envVal := os.Getenv("UCL_MAX_PAYLOAD_BYTES"); envVal != "" {
		if val, err := strconv.Atoi(envVal); err == nil && val > 0 {
			return val
		}
	}
	return staging.MaxPayloadBytes
}
