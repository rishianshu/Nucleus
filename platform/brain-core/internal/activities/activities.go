// Package activities implements Temporal activities for UCL connectors.
package activities

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/nucleus/brain-core/internal/bridge"
	"github.com/nucleus/ucl-core/pkg/cdm"
	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/orchestration"
	"github.com/nucleus/ucl-core/pkg/staging"
	"github.com/nucleus/store-core/pkg/vectorstore"
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
		if len(ds.Metadata) > 0 {
			payload["properties"] = ds.Metadata
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

	readReq := &endpoint.ReadRequest{
		DatasetID: req.UnitID,
		Limit:     int64(limit),
	}

	filter := map[string]any{}
	if path, ok := params["path"]; ok {
		filter["path"] = path
	}
	if ref, ok := params["ref"]; ok {
		filter["ref"] = ref
	}
	if len(filter) > 0 {
		readReq.Filter = filter
	}

	iter, err := ep.Read(ctx, readReq)
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
	logger.Info("ingestion parameters", "templateId", templateID, "params", params)

	// P2 Fix: Extract target_slice_size from policy
	targetSliceSize := resolveTargetSliceSize(req.Policy)
	if targetSliceSize > 0 {
		logger.Info("using target slice size", "targetSliceSize", targetSliceSize)
	}

	// Resolve schema upfront to hand down to sinks.
	var planSchema *endpoint.Schema

	// Try to get SliceCapable endpoint
	sliceCapable, err := bridge.GetSliceCapableEndpoint(templateID, params)
	if err != nil {
		// Fallback: single slice for full sync
		logger.Warn("endpoint does not support slicing, using single slice", "error", err)
		planSchema = resolveSchemaForUnit(ctx, templateID, params, req.UnitID, req.CDMModelID, nil)
		return &PlanResult{
			Slices: []SliceDescriptor{
				{SliceKey: "full", Sequence: 0},
			},
			Strategy: "full",
			PlanMetadata: map[string]any{
				"reason":    "endpoint_not_slice_capable",
				"schema":    planSchema,
				"datasetId": req.UnitID,
			},
		}, nil
	}
	sourceCandidate, _ := sliceCapable.(endpoint.SourceEndpoint)
	planSchema = resolveSchemaForUnit(ctx, templateID, params, req.UnitID, req.CDMModelID, sourceCandidate)

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
	if planSchema != nil {
		planMetadata["schema"] = planSchema
	}
	if req.CDMModelID != "" {
		planMetadata["cdmModelId"] = req.CDMModelID
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
	if req.SinkID == "" {
		return nil, fmt.Errorf("sinkId is required for ingestion execution")
	}

	params := bridge.NormalizeParameters(templateID, bridge.ResolveParameters(req.Policy))

	// Get endpoint
	ep, err := bridge.GetSourceEndpoint(templateID, params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	// Check if endpoint supports vector profile for normalized indexing
	vectorProvider, supportsVectorProfile := ep.(endpoint.VectorProfileProvider)
	if supportsVectorProfile {
		logger.Info("endpoint-supports-vector-profile", "templateId", templateID)
	}

	// P1 Fix: Handle dataMode for checkpoint reset
	// dataMode "reset" means ignore existing checkpoint and start fresh
	checkpoint := req.Checkpoint
	if strings.EqualFold(req.DataMode, "reset") || strings.EqualFold(req.DataMode, "full") {
		logger.Info("dataMode requires checkpoint reset", "dataMode", req.DataMode)
		checkpoint = nil
	}

	// CHECKPOINT FIX: Normalize checkpoint before passing to connector.
	// Legacy checkpoints may have deeply nested cursor structures (35+ levels).
	// We need to flatten them so connectors can find watermark/cursor at top level.
	if checkpoint != nil {
		checkpoint = normalizeCheckpointForRead(checkpoint)
		logger.Info("checkpoint-normalized", "checkpoint", checkpoint)
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

	sliceID := "full"
	if req.Slice != nil {
		if key := getStringFromMap(req.Slice, "slice_key", ""); key != "" {
			sliceID = key
		}
	}

	// Check if we have a slice to execute
	if req.Slice != nil {
		sliceCapable, ok := ep.(endpoint.SliceCapable)
		if !ok {
			return nil, fmt.Errorf("endpoint does not support slice operations")
		}

		slice := &endpoint.IngestionSlice{
			SliceID: sliceID,
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

	isPreviewMode := strings.EqualFold(req.Mode, "PREVIEW")

	// Set up staging providers (prefer object/minio so batches survive process restarts).
	var provider staging.Provider
	stagingProviderID := ""
	if !isPreviewMode {
		registry := orchestration.DefaultStagingRegistry()
		if disableObjectStore(req.Policy) {
			// Override with memory-only when explicitly disabled.
			registry = staging.NewRegistry(staging.NewMemoryProvider(staging.DefaultMemoryCapBytes))
		}
		logger.Info("staging-registry", "providers", registry.ProviderIDs())

		// Prefer an explicit provider; default to MinIO/object-store to keep stages durable.
		preferred := req.StagingProviderID
		if preferred == "" {
			preferred = staging.ProviderMinIO
			logger.Info("stagingProviderId defaulted to MinIO", "provider", preferred)
		}
		if preferred != "" {
			if p, ok := registry.Get(preferred); ok {
				provider = p
			} else if req.StagingProviderID != "" {
				// Explicit provider requested but not found - return error
				return nil, fmt.Errorf("stagingProviderId '%s' not available; registered providers: %v", req.StagingProviderID, registry.ProviderIDs())
			}
		}
		// If MinIO is registered, prefer it as the durable default.
		if provider == nil {
			if p, ok := registry.Get(staging.ProviderMinIO); ok {
				provider = p
			}
		}

		// Fall back to size-based selection (object-store first for durability).
		if provider == nil {
			estimatedBytes := resolveEstimatedBytes(req.Policy)
			if estimatedBytes <= 0 {
				estimatedBytes = staging.DefaultLargeRunThresholdBytes + 1
			}

			provider, err = registry.SelectProvider(preferred, estimatedBytes, staging.DefaultLargeRunThresholdBytes)
			if err != nil {
				return nil, fmt.Errorf("staging unavailable: %w", err)
			}
		}

		if provider != nil {
			stagingProviderID = provider.ID()
			logger.Info("staging-provider-selected",
				"requested", req.StagingProviderID,
				"preferred", preferred,
				"selected", stagingProviderID,
			)
		}
	}

	// Stream records and stage in batches (no bulk payloads in activity response).
	const chunkSize = 10000
	envelopes := make([]staging.RecordEnvelope, 0, chunkSize)
	var previewRecords []map[string]any
	var normalized []map[string]any
	var stageRef string
	var batchRefs []string
	var bytesStaged int64
	var recordCount int64
	batchSeq := 0

	flush := func() error {
		if len(envelopes) == 0 {
			return nil
		}
		res, err := provider.PutBatch(ctx, &staging.PutBatchRequest{
			StageRef: stageRef,
			SliceID:  sliceID,
			BatchSeq: batchSeq,
			Records:  envelopes,
		})
		if err != nil {
			return err
		}
		stageRef = res.StageRef
		batchRefs = append(batchRefs, res.BatchRef)
		bytesStaged += res.Stats.Bytes
		batchSeq++
		envelopes = envelopes[:0]
		return nil
	}

	for iter.Next() {
		record := iter.Value()
		recordCount++

		if isPreviewMode {
			previewRecords = append(previewRecords, record)
			continue
		}

		// Normalize here so sinks receive structured records.
		norm := normalizeRecord(record, req)
		normalized = append(normalized, norm)

		// If endpoint supports VectorProfileProvider, produce vector-ready envelope
		var vectorPayload map[string]any
		if supportsVectorProfile {
			if vecRec, ok := vectorProvider.NormalizeForIndex(record); ok {
				vectorPayload = map[string]any{
					"nodeId":       vecRec.NodeID,
					"profileId":    vecRec.ProfileID,
					"entityKind":   vecRec.EntityKind,
					"text":         vecRec.Text,
					"sourceFamily": vecRec.SourceFamily,
					"tenantId":     vecRec.TenantID,
					"projectKey":   vecRec.ProjectKey,
					"sourceUrl":    vecRec.SourceURL,
					"externalId":   vecRec.ExternalID,
					"metadata":     vecRec.Metadata,
				}
			}
		}

		envelopes = append(envelopes, staging.RecordEnvelope{
			RecordKind: "raw",
			EntityKind: req.UnitID,
			Source: staging.SourceRef{
				EndpointID:   req.EndpointID,
				SourceFamily: templateID,
				SourceID:     req.UnitID,
			},
			Payload:       norm,
			VectorPayload: vectorPayload,
			ObservedAt:    time.Now().UTC().Format(time.RFC3339),
		})

		if len(envelopes) >= chunkSize {
			if err := flush(); err != nil {
				return nil, fmt.Errorf("failed to stage records chunk: %w", err)
			}
		}
	}

	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("iteration error: %w", err)
	}

	if !isPreviewMode {
		if err := flush(); err != nil {
			return nil, fmt.Errorf("failed to stage final records: %w", err)
		}
		// Leave in-memory stages intact so downstream sink/index/signal activities can read them.
		if stageRef != "" && provider != nil && provider.ID() != staging.ProviderMemory {
			_ = provider.FinalizeStage(ctx, stageRef)
		}
	}

	stagedRecords := recordCount
	if isPreviewMode {
		stagedRecords = 0
	}

	// Build stats with more detail
	stats := map[string]any{
		"recordCount":   recordCount,
		"recordsRead":   recordCount,
		"recordsStaged": stagedRecords,
		"unitId":        req.UnitID,
		"templateId":    templateID,
		"dataMode":      req.DataMode,
		"mode":          req.Mode,
		"stageRef":      stageRef,
		"bytesStaged":   bytesStaged,
		"batches":       len(batchRefs),
	}

	// CODEX FIX: Build checkpoint with fallback to preserve incoming metadata
	// Start with incoming checkpoint to preserve prior metadata (per Python behavior)
	newCheckpoint := mergeCheckpoints(req.Checkpoint, nil)

	// Override with iterator checkpoint if available (newer data takes precedence)
	if cp, ok := iter.(interface{ Checkpoint() *endpoint.Checkpoint }); ok {
		if iterCheckpoint := cp.Checkpoint(); iterCheckpoint != nil {
			logger.Info("[checkpoint-debug] iterator returned checkpoint", "watermark", iterCheckpoint.Watermark, "metadataKeys", len(iterCheckpoint.Metadata))
			newCheckpoint["watermark"] = iterCheckpoint.Watermark
			for k, v := range iterCheckpoint.Metadata {
				newCheckpoint[k] = v
			}
			// CHECKPOINT FIX: Remove legacy cursor objects that would override watermark in TypeScript
			// TypeScript code does: cpData.cursor ?? cpData.watermark - if cursor is object, watermark is lost
			if cursorVal, hasCursor := newCheckpoint["cursor"]; hasCursor {
				if _, isObject := cursorVal.(map[string]any); isObject {
					logger.Info("[checkpoint-debug] removing legacy cursor object to preserve watermark")
					delete(newCheckpoint, "cursor")
				}
			}
		} else {
			logger.Info("[checkpoint-debug] iterator checkpoint is nil")
		}
	} else {
		logger.Info("[checkpoint-debug] iterator does not implement Checkpoint()")
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
		StageRef:          stageRef,
		BatchRefs:         batchRefs,
		BytesStaged:       bytesStaged,
		RecordsStaged:     stagedRecords,
		StagingProviderID: stagingProviderID,
		TransientState:    resultTransientState, // P1 Fix: Forward transientState
	}

	// Include records only in PREVIEW mode
	if isPreviewMode {
		result.Records = previewRecords
		result.StageRef = ""
		result.BatchRefs = nil
	}
	// Debug: Log final checkpoint state before return
	if wm, ok := newCheckpoint["watermark"]; ok {
		logger.Info("[checkpoint-debug] returning checkpoint with watermark", "watermark", wm)
	} else {
		logger.Warn("[checkpoint-debug] returning checkpoint WITHOUT watermark", "keys", len(newCheckpoint))
	}
	if _, hasCursor := newCheckpoint["cursor"]; hasCursor {
		logger.Warn("[checkpoint-debug] returning checkpoint WITH cursor object still present")
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

func disableObjectStore(policy map[string]any) bool {
	if policy == nil {
		return false
	}
	// Explicit disable flag
	if v, ok := policy["disableObjectStore"].(bool); ok {
		return v
	}
	if v, ok := policy["disable_object_store"].(bool); ok {
		return v
	}
	// If objectStoreEnabled is provided and false, treat as disabled
	if v, ok := policy["objectStoreEnabled"].(bool); ok {
		return !v
	}
	if v, ok := policy["object_store_enabled"].(bool); ok {
		return !v
	}
	return false
}

func resolveEstimatedBytes(policy map[string]any) int64 {
	if policy == nil {
		return 0
	}
	for _, key := range []string{"estimatedBytes", "estimated_bytes", "estimatedSizeBytes"} {
		if v, ok := policy[key]; ok {
			switch val := v.(type) {
			case int:
				return int64(val)
			case int64:
				return val
			case float64:
				return int64(val)
			case string:
				if parsed, err := strconv.ParseInt(val, 10, 64); err == nil {
					return parsed
				}
			}
		}
	}
	return 0
}

// normalizeRecord maps connector-specific record maps into a normalized envelope for sinks.
func normalizeRecord(rec map[string]any, req IngestionRequest) map[string]any {
	entity := req.UnitID
	if v, ok := rec["_entity"].(string); ok && v != "" {
		entity = v
	} else if v, ok := rec["_datasetType"].(string); ok && v != "" {
		entity = v
	}
	logical := ""
	switch {
	case isString(rec, "_externalId"):
		logical = rec["_externalId"].(string)
	case isString(rec, "sha"):
		logical = rec["sha"].(string)
	case isString(rec, "issueId"):
		logical = rec["issueId"].(string)
	case isNumber(rec, "number"):
		logical = fmt.Sprintf("%v", rec["number"])
	}
	if logical == "" {
		logical = fmt.Sprintf("%s-%d", req.UnitID, time.Now().UnixNano())
	}
	display := logical
	if v, ok := rec["title"].(string); ok && v != "" {
		display = v
	} else if v, ok := rec["path"].(string); ok && v != "" {
		display = v
	}
	return map[string]any{
		"entityType":  entity,
		"logicalId":   logical,
		"displayName": display,
		"scope": map[string]any{
			"orgId": "default",
		},
		"provenance": map[string]any{
			"endpointId": req.EndpointID,
			"vendor":     req.EndpointID,
		},
		"payload": rec,
	}
}

func isString(rec map[string]any, key string) bool {
	if v, ok := rec[key]; ok {
		_, ok := v.(string)
		return ok
	}
	return false
}

func isNumber(rec map[string]any, key string) bool {
	if v, ok := rec[key]; ok {
		switch v.(type) {
		case int, int64, float64:
			return true
		}
	}
	return false
}

// newMinioStagingProviderFromEnv builds a MinIO staging provider if env is configured.
// resolveSchemaForUnit selects a schema using CDM model or source endpoint.
func resolveSchemaForUnit(
	ctx context.Context,
	templateID string,
	params map[string]any,
	unitID string,
	cdmModelID string,
	candidate endpoint.SourceEndpoint,
) *endpoint.Schema {
	// Prefer CDM-defined schema when provided.
	if schema := schemaFromCDM(cdmModelID); schema != nil {
		return schema
	}

	if candidate != nil {
		if schema, err := candidate.GetSchema(ctx, unitID); err == nil && schema != nil && len(schema.Fields) > 0 {
			return schema
		}
	}

	src, err := bridge.GetSourceEndpoint(templateID, params)
	if err != nil {
		return nil
	}
	defer src.Close()

	schema, err := src.GetSchema(ctx, unitID)
	if err != nil || schema == nil || len(schema.Fields) == 0 {
		return nil
	}
	return schema
}

func schemaFromCDM(modelID string) *endpoint.Schema {
	cols := cdm.ModelSchema(modelID)
	if len(cols) == 0 {
		return nil
	}
	fields := make([]*endpoint.FieldDefinition, 0, len(cols))
	for idx, col := range cols {
		fields = append(fields, &endpoint.FieldDefinition{
			Name:     col.Name,
			DataType: col.Type,
			Nullable: col.Nullable,
			Position: idx + 1,
		})
	}
	return &endpoint.Schema{Fields: fields}
}

// IndexArtifact streams records from a sink endpoint used as a source and returns counters + checkpoint.
func (a *Activities) IndexArtifact(ctx context.Context, req IndexArtifactRequest) (*IndexArtifactResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("[IndexArtifact-ENTRY] activity started", "artifactId", req.ArtifactID, "sinkEndpointId", req.SinkEndpointID, "datasetSlug", req.DatasetSlug, "stageRef", req.StageRef, "batchRefsCount", len(req.BatchRefs))
	regClient, _ := newRegistryClient()
	defer regClient.Close()

	// Hydrate request fields from registry if available.
	if regClient != nil && req.ArtifactID != "" {
		if art, err := regClient.getArtifact(ctx, req.ArtifactID); err == nil && art != nil {
			if req.SinkEndpointID == "" && art.SinkEndpointID != "" {
				req.SinkEndpointID = art.SinkEndpointID
			}
			if req.SourceFamily == "" && art.SourceFamily != "" {
				req.SourceFamily = art.SourceFamily
			}
			if req.TenantID == "" && art.TenantID != "" {
				req.TenantID = art.TenantID
			}
			// Handle payload: expect keys like bucket/basePrefix/datasetSlug
			if req.DatasetSlug == "" {
				if slug, ok := art.Handle["datasetSlug"].(string); ok {
					req.DatasetSlug = slug
				}
			}
			if req.Bucket == "" {
				if b, ok := art.Handle["bucket"].(string); ok {
					req.Bucket = b
				}
			}
			if req.BasePrefix == "" {
				if p, ok := art.Handle["basePrefix"].(string); ok {
					req.BasePrefix = p
				}
			}
		}
	}

	if strings.TrimSpace(req.SinkEndpointID) == "" {
		return nil, fmt.Errorf("sinkEndpointId is required")
	}
	if strings.TrimSpace(req.DatasetSlug) == "" {
		return nil, fmt.Errorf("datasetSlug is required")
	}

	useStaging := strings.TrimSpace(req.StageRef) != "" && len(req.BatchRefs) > 0

	if regClient != nil {
		regClient.markIndexing(ctx, req.ArtifactID)
	}

	cp := map[string]any{}
	for k, v := range req.Checkpoint {
		cp[k] = v
	}
	tenantID := req.TenantID
	if tenantID == "" {
		tenantID = os.Getenv("TENANT_ID")
		if tenantID == "" {
			tenantID = "dev"
		}
	}
	projectID := req.ProjectID
	if projectID == "" {
		projectID = os.Getenv("METADATA_DEFAULT_PROJECT")
		if projectID == "" {
			projectID = "global"
		}
	}
	// If no checkpoint provided, try to load persisted checkpoint keyed by profile+dataset.
	profileID := req.ProfileID
	if profileID == "" {
		// Prefer CDM profile when cdmModelId is present.
		if req.CdmModelID != "" {
			profileID = fmt.Sprintf("cdm.%s.v1", strings.TrimPrefix(req.CdmModelID, "cdm."))
		} else {
			// Fallback by source family if available
			switch strings.ToLower(req.SourceFamily) {
			case "github":
				if strings.Contains(strings.ToLower(req.DatasetSlug), "issue") {
					profileID = "source.github.issues.v1"
				} else {
					profileID = "source.github.code.v1"
				}
			case "jira":
				profileID = "source.jira.issues.v1"
			case "confluence":
				profileID = "source.confluence.pages.v1"
			case "onedrive":
				profileID = "source.onedrive.docs.v1"
			default:
				profileID = "source.generic.v1"
			}
		}
	}
	if len(cp) == 0 {
		key := makeCheckpointKey(profileID, req.DatasetSlug)
		if persisted, err := loadCheckpointKV(ctx, tenantID, projectID, key); err == nil && persisted != nil {
			for k, v := range persisted {
				cp[k] = v
			}
		}
	}
	if req.RunID != "" {
		cp["runId"] = req.RunID
	}

	var (
		iter    endpoint.Iterator[endpoint.Record]
		closeFn func()
		err     error
	)
	if useStaging {
		iter, closeFn, err = streamFromStaging(ctx, req.StagingProviderID, req.StageRef, "", req.DatasetSlug, cp, 0)
	} else {
		ep, epErr := endpoint.Create(req.SinkEndpointID, req.EndpointConfig)
		if epErr != nil {
			return nil, fmt.Errorf("create endpoint: %w", epErr)
		}
		source, ok := ep.(endpoint.SourceEndpoint)
		if !ok {
			ep.Close()
			return nil, fmt.Errorf("endpoint %s does not implement SourceEndpoint", req.SinkEndpointID)
		}
		iter, err = source.Read(ctx, &endpoint.ReadRequest{
			DatasetID:  req.DatasetSlug,
			Checkpoint: cp,
		})
		if err != nil {
			ep.Close()
			return nil, fmt.Errorf("read dataset: %w", err)
		}
		closeFn = func() {
			_ = iter.Close()
			ep.Close()
		}
	}
	if err != nil {
		return nil, err
	}
	if closeFn == nil {
		closeFn = func() {}
	}
	defer closeFn()

	var recordsRead int64
	var lastKey, lastRun string
	var lastBatch string
	var lastOffset int
	var normalized []vectorstore.Entry
	var contents []string
	var kbEvents []kbEvent
	var kbSeq int64
	for iter.Next() {
		rec := iter.Value()
		recordsRead++
		if key, ok := rec["objectKey"].(string); ok {
			lastKey = key
		}
		if run, ok := rec["runId"].(string); ok {
			lastRun = run
		}
		if b, ok := rec["batchRef"].(string); ok {
			lastBatch = b
		}
		if off, ok := rec["recordOffset"].(int); ok {
			lastOffset = off
		} else if off, ok := rec["recordOffset"].(float64); ok {
			lastOffset = int(off)
		}

		// Prefer pre-normalized vectorPayload from staging (produced by VectorProfileProvider endpoints)
		var entry vectorstore.Entry
		var content string
		var ok bool

		if vp, hasVector := rec["vectorPayload"].(map[string]any); hasVector && vp != nil {
			// Use pre-normalized vector record from staging
			nodeID := asString(vp["nodeId"])
			text := asString(vp["text"])
			vpProject := asString(vp["projectKey"])
			if nodeID != "" && text != "" {
				entry = vectorstore.Entry{
					TenantID:       asString(vp["tenantId"]),
					ProjectID:      vpProject,
					ProfileID:      asString(vp["profileId"]),
					NodeID:         nodeID,
					SourceFamily:   asString(vp["sourceFamily"]),
					SinkEndpointID: req.SinkEndpointID,
					DatasetSlug:    req.DatasetSlug,
					EntityKind:     asString(vp["entityKind"]),
					ContentText:    text,
				}
				if meta, ok := vp["metadata"].(map[string]any); ok {
					entry.Metadata = meta
				}
				if entry.TenantID == "" {
					entry.TenantID = tenantID
				}
				if entry.ProjectID == "" {
					entry.ProjectID = projectID
				}
				if entry.SourceFamily == "" {
					entry.SourceFamily = req.SourceFamily
				}
				content = text
				ok = true
			}
		}

		// Fallback to legacy normalizer for backward compatibility
		if !ok {
			entry, content, ok = normalizeVectorRecord(rec, profileID, tenantID, projectID, req.DatasetSlug, req.SinkEndpointID)
		}

		if ok {
			entry.ArtifactID = req.ArtifactID
			entry.RunID = req.RunID
			normalized = append(normalized, entry)
			contents = append(contents, content)
			kbSeq++
			sum := sha1.Sum([]byte(entry.NodeID + req.RunID))
			kbEvents = append(kbEvents, kbEvent{
				Seq:         kbSeq,
				RunID:       req.RunID,
				DatasetSlug: req.DatasetSlug,
				Op:          "upsert_node",
				Kind:        "vector_entry",
				ID:          entry.NodeID,
				Hash:        fmt.Sprintf("%x", sum[:6]),
				At:          time.Now().UTC().Format(time.RFC3339),
			})
		}
	}
	if err := iter.Err(); err != nil {
		if regClient != nil {
			regClient.markIndexFailed(ctx, req.ArtifactID, err.Error())
		}
		logger.Warn("index-iteration-error", "err", err)
		return nil, err
	}

	// Embed and upsert
	if len(normalized) > 0 {
		// Content hash check: skip entries with unchanged content to save API tokens
		var needsEmbedding []vectorstore.Entry
		var needsEmbeddingContents []string
		var skippedCount int64
		var contentHashes []string // store hashes for entries that need embedding

		for i, entry := range normalized {
			currentHash := hashContent(contents[i])
			existingHash, _ := loadEmbeddingHash(ctx, tenantID, projectID, profileID, entry.NodeID)

			if existingHash != "" && existingHash == currentHash {
				logger.Debug("[IndexArtifact] skipping unchanged content", "nodeId", entry.NodeID)
				skippedCount++
				continue
			}

			// Store hash in entry metadata for later save
			if entry.Metadata == nil {
				entry.Metadata = make(map[string]any)
			}
			entry.Metadata["contentHash"] = currentHash
			needsEmbedding = append(needsEmbedding, entry)
			needsEmbeddingContents = append(needsEmbeddingContents, contents[i])
			contentHashes = append(contentHashes, currentHash)
		}

		logger.Info("[IndexArtifact] content hash check", "total", len(normalized), "skipped", skippedCount, "needsEmbedding", len(needsEmbedding))

		// Only call embedding API if there are entries that need it
		if len(needsEmbedding) == 0 {
			logger.Info("[IndexArtifact] all entries unchanged, skipping embedding API call")
		} else {
			logger.Info("[IndexArtifact-debug] starting embedding", "normalizedCount", len(needsEmbedding), "contentsCount", len(needsEmbeddingContents))
			embedder, err := getEmbeddingProvider()
			if err != nil {
				logger.Error("[IndexArtifact-debug] getEmbeddingProvider failed", "error", err.Error())
				if regClient != nil {
					regClient.markIndexFailed(ctx, req.ArtifactID, err.Error())
				}
				return nil, err
			}
			logger.Info("[IndexArtifact-debug] calling EmbedText", "contentsCount", len(needsEmbeddingContents))
			embeddings, err := embedder.EmbedText("", needsEmbeddingContents) // use default model
			if err != nil {
				logger.Error("[IndexArtifact-debug] EmbedText failed", "error", err.Error())
				if regClient != nil {
					regClient.markIndexFailed(ctx, req.ArtifactID, err.Error())
				}
				return nil, err
			}
			logger.Info("[IndexArtifact-debug] EmbedText succeeded", "embeddingsCount", len(embeddings), "model", embedder.ModelName())
			for i := range needsEmbedding {
				needsEmbedding[i].Embedding = embeddings[i]
				if needsEmbedding[i].Metadata == nil {
					needsEmbedding[i].Metadata = make(map[string]any)
				}
				needsEmbedding[i].Metadata["embeddingModel"] = embedder.ModelName()
			}
			logger.Info("[IndexArtifact-debug] getting vector store")
			client, err := getVectorStore()
			if err != nil {
				logger.Error("[IndexArtifact-debug] getVectorStore failed", "error", err.Error())
				if regClient != nil {
					regClient.markIndexFailed(ctx, req.ArtifactID, err.Error())
				}
				return nil, err
			}
			logger.Info("[IndexArtifact-debug] calling UpsertEntries", "entryCount", len(needsEmbedding))
			if err := client.UpsertEntries(ctx, touchUpdatedAt(needsEmbedding)); err != nil {
				logger.Error("[IndexArtifact-debug] UpsertEntries failed", "error", err.Error())
				if regClient != nil {
					regClient.markIndexFailed(ctx, req.ArtifactID, err.Error())
				}
				return nil, err
			}
			logger.Info("[IndexArtifact-debug] UpsertEntries succeeded", "entryCount", len(needsEmbedding))

			// Save content hashes for successfully embedded entries
			for i, entry := range needsEmbedding {
				saveEmbeddingHash(ctx, tenantID, projectID, profileID, entry.NodeID, contentHashes[i])
			}
			logger.Info("[IndexArtifact] saved content hashes", "count", len(needsEmbedding))
		}
	}

	newCheckpoint := map[string]any{}
	if useStaging {
		if lastBatch != "" {
			newCheckpoint["batchRef"] = lastBatch
			newCheckpoint["recordOffset"] = lastOffset
		}
	} else {
		if lastKey != "" {
			newCheckpoint["cursor"] = lastKey
		}
		if lastRun != "" {
			newCheckpoint["runId"] = lastRun
		}
	}

	logger.Info("index-artifact", "dataset", req.DatasetSlug, "records", recordsRead, "lastKey", lastKey, "runId", lastRun, "useStaging", useStaging, "lastBatch", lastBatch, "lastOffset", lastOffset)
	key := makeCheckpointKey(profileID, req.DatasetSlug)
	if err := saveCheckpointKV(ctx, tenantID, projectID, key, newCheckpoint); err != nil {
		logger.Warn("checkpoint-save-failed", "err", err)
	}
	eventsPath, snapPath := saveKBEvents(ctx, tenantID, projectID, req.DatasetSlug, req.RunID, kbEvents, kbSeq)
	if regClient != nil {
		regClient.markIndexed(ctx, req.ArtifactID, map[string]any{
			"recordsRead":     recordsRead,
			"recordsIndexed":  int64(len(normalized)),
			"sinkEndpointId":  req.SinkEndpointID,
			"sourceFamily":    req.SourceFamily,
			"runId":           req.RunID,
			"useStaging":      useStaging,
			"lastBatch":       lastBatch,
			"lastCursor":      lastKey,
			"lastRecordIndex": lastOffset,
			"kbEvents":        kbSeq,
			"logEventsPath":   eventsPath,
			"logSnapshotPath": snapPath,
		})
	}

	return &IndexArtifactResult{
		RecordsIndexed: recordsRead, // until embeddings are added, treat read count as indexed
		ObjectsScanned: recordsRead, // approximate
		RecordsRead:    recordsRead,
		Checkpoint:     newCheckpoint,
		Status:         "SUCCEEDED",
	}, nil
}

// mergeCheckpoints merges incoming checkpoint with updates, ensuring flat structure.
// It specifically handles recursive 'cursor' nesting which was a bug.
// This function recursively flattens any depth of nested cursors (e.g., cursor.cursor.cursor...).
func mergeCheckpoints(base map[string]any, _ map[string]any) map[string]any {
	out := make(map[string]any)
	if base != nil {
		for k, v := range base {
			out[k] = v
		}
	}
	// Recursively flatten 'cursor' if it contains nested 'cursor' fields
	// This handles legacy checkpoints with arbitrary nesting depth
	out["cursor"] = flattenCursor(out["cursor"])
	return out
}

// flattenCursor recursively unwraps nested cursor objects.
// If cursor is a map with a "cursor" key, it extracts the innermost non-map cursor.
func flattenCursor(cursor any) any {
	if cursor == nil {
		return nil
	}
	cursorMap, ok := cursor.(map[string]any)
	if !ok {
		// Not a map, return as-is (could be a string, int, etc.)
		return cursor
	}
	// Check if this map has a nested "cursor" key
	if inner, hasInner := cursorMap["cursor"]; hasInner {
		// Recursively flatten the inner cursor
		return flattenCursor(inner)
	}
	// No nested cursor, check if it has useful data (watermark, etc.)
	// If it's just metadata without a cursor value, extract watermark if present
	if wm, ok := cursorMap["watermark"]; ok {
		return wm
	}
	// Return the map as-is if it has other useful checkpoint data
	return cursorMap
}

// normalizeCheckpointForRead flattens a deeply nested checkpoint into a normalized structure.
// This handles legacy checkpoints with 35+ levels of cursor nesting by extracting
// the actual watermark value and placing it at the top level.
func normalizeCheckpointForRead(cp map[string]any) map[string]any {
	if cp == nil {
		return nil
	}

	// First, try to find watermark at the current level
	if wm, ok := cp["watermark"].(string); ok && wm != "" {
		return cp // Already has top-level watermark
	}

	// Try to extract watermark from nested cursor structures
	flatCursor := flattenCursor(cp["cursor"])
	if flatCursor == nil && cp["cursor"] != nil {
		// Try the entire map as a cursor source
		flatCursor = flattenCursor(cp)
	}

	// Build normalized checkpoint
	normalized := make(map[string]any)

	// Extract watermark from flattened cursor
	switch v := flatCursor.(type) {
	case string:
		// The cursor itself is the watermark
		normalized["watermark"] = v
		normalized["cursor"] = v
	case map[string]any:
		// Try to find watermark in the map
		if wm, ok := v["watermark"].(string); ok && wm != "" {
			normalized["watermark"] = wm
		}
		if cursor, ok := v["cursor"]; ok {
			normalized["cursor"] = cursor
		}
		// Copy other relevant fields
		for _, key := range []string{"lastRunAt", "lastRunId", "recordCount", "dataMode"} {
			if val, ok := v[key]; ok {
				normalized[key] = val
			}
		}
	}

	// Also check for metadata-wrapped watermark
	if meta, ok := cp["metadata"].(map[string]any); ok {
		if wm, ok := meta["watermark"].(string); ok && wm != "" {
			normalized["watermark"] = wm
		}
		for _, key := range []string{"lastRunAt", "lastRunId", "recordCount", "dataMode"} {
			if val, ok := meta[key]; ok && normalized[key] == nil {
				normalized[key] = val
			}
		}
	}

	// If still no watermark found, return original to preserve any data
	if normalized["watermark"] == nil || normalized["watermark"] == "" {
		return cp
	}

	return normalized
}

