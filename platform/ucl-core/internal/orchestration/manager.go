package orchestration

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	minio "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/staging"
)

// Manager owns in-process operation state for StartOperation/GetOperation.
type Manager struct {
	mu  sync.Mutex
	ops map[string]*pb.OperationState
}

// NewManager creates a new operation manager.
func NewManager() *Manager {
	return &Manager{ops: make(map[string]*pb.OperationState)}
}

// StartOperation stores an operation and kicks off ingestion if requested.
func (m *Manager) StartOperation(ctx context.Context, req *pb.StartOperationRequest) (*pb.StartOperationResponse, error) {
	opID := req.GetIdempotencyKey()
	if opID == "" {
		opID = fmt.Sprintf("op-%d", time.Now().UnixNano())
	}

	state := &pb.OperationState{
		OperationId: opID,
		Kind:        req.Kind,
		Status:      pb.OperationStatus_QUEUED,
		StartedAt:   time.Now().UnixMilli(),
		Retryable:   true,
		Stats:       map[string]string{},
	}
	m.saveState(state)

	switch req.Kind {
	case pb.OperationKind_INGESTION_RUN:
		go m.runIngestion(opID, req)
	default:
		go m.markSucceeded(opID)
	}

	return &pb.StartOperationResponse{
		OperationId: opID,
		State:       m.cloneState(opID),
	}, nil
}

// GetOperation returns the latest operation state.
func (m *Manager) GetOperation(ctx context.Context, req *pb.GetOperationRequest) (*pb.OperationState, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	state := m.cloneState(req.OperationId)
	if state == nil {
		return &pb.OperationState{
			OperationId: req.OperationId,
			Status:      pb.OperationStatus_FAILED,
			Error: &pb.ErrorDetail{
				Code:      "E_OPERATION_NOT_FOUND",
				Message:   "operation not found",
				Retryable: false,
			},
		}, nil
	}
	return state, nil
}

func (m *Manager) runIngestion(opID string, req *pb.StartOperationRequest) {
	now := time.Now().UnixMilli()
	m.updateState(opID, func(state *pb.OperationState) {
		state.Status = pb.OperationStatus_RUNNING
		state.StartedAt = now
		state.Retryable = true
		setStat(state, "slicesTotal", 0)
		setStat(state, "slicesDone", 0)
		setStat(state, "recordsStaged", 0)
		setStat(state, "recordsWritten", 0)
	})

	ctx := context.Background()
	source, datasetID, err := buildSourceEndpoint(req)
	if err != nil {
		m.failOperation(opID, "E_ENDPOINT_NOT_FOUND", err, false)
		return
	}

	plan, err := m.buildPlan(ctx, source, datasetID, req)
	if err != nil {
		code, retryable := classifyError(err)
		m.failOperation(opID, code, err, retryable)
		return
	}

	m.updateState(opID, func(state *pb.OperationState) {
		setStat(state, "slicesTotal", len(plan.Slices))
	})

	provider, err := m.selectProvider(plan, req.Parameters)
	if err != nil {
		code, retryable := classifyError(err)
		m.failOperation(opID, code, err, retryable)
		return
	}
	if provider == nil || provider.ID() == "" {
		err := fmt.Errorf("stagingProviderId is required for ingestion")
		m.failOperation(opID, string(staging.CodeStagingUnavailable), err, false)
		return
	}
	m.updateState(opID, func(state *pb.OperationState) {
		setStat(state, "stagingProviderId", provider.ID())
	})

	var recordsStaged int64
	var bytesStaged int64
	var recordsWritten int64

	for idx, slice := range plan.Slices {
		sliceStats, execErr := m.executeSlice(ctx, provider, source, slice, datasetID, req.TemplateId, req.EndpointId, opID)
		if execErr != nil {
			code, retryable := classifyError(execErr)
			m.failOperation(opID, code, execErr, retryable)
			return
		}
		recordsStaged += sliceStats.staged
		bytesStaged += sliceStats.bytes
		recordsWritten += sliceStats.written

		m.updateState(opID, func(state *pb.OperationState) {
			setStat(state, "slicesDone", idx+1)
			setStat(state, "recordsStaged", recordsStaged)
			setStat(state, "bytesStaged", bytesStaged)
			setStat(state, "recordsWritten", recordsWritten)
			if sliceStats.stageRef != "" {
				setStat(state, "stageRef", sliceStats.stageRef)
			}
			if sliceStats.batches > 0 {
				setStat(state, "batches", sliceStats.batches)
			}
			state.Retryable = false
		})
	}

	m.updateState(opID, func(state *pb.OperationState) {
		state.Status = pb.OperationStatus_SUCCEEDED
		state.CompletedAt = time.Now().UnixMilli()
		state.Retryable = false
	})
}

func (m *Manager) buildPlan(ctx context.Context, ep endpoint.SourceEndpoint, datasetID string, req *pb.StartOperationRequest) (*endpoint.IngestionPlan, error) {
	pageLimit := int(paramInt(req.Parameters, "page_limit", "pageLimit", "target_slice_size"))
	if pageLimit <= 0 {
		pageLimit = 100
	}

	filters := map[string]any{}

	if adaptive, ok := ep.(endpoint.AdaptiveIngestion); ok {
		probe, _ := adaptive.ProbeIngestion(ctx, &endpoint.ProbeRequest{
			DatasetID: datasetID,
			Filters:   filters,
		})
		return adaptive.PlanIngestion(ctx, &endpoint.PlanIngestionRequest{
			DatasetID: datasetID,
			Filters:   filters,
			PageLimit: pageLimit,
			Probe:     probe,
		})
	}

	if slicer, ok := ep.(endpoint.SliceCapable); ok {
		return slicer.PlanSlices(ctx, &endpoint.PlanRequest{
			DatasetID:       datasetID,
			Strategy:        "full",
			Checkpoint:      nil,
			TargetSliceSize: int64(pageLimit),
		})
	}

	return &endpoint.IngestionPlan{
		DatasetID: datasetID,
		Strategy:  "full",
		Slices: []*endpoint.IngestionSlice{
			{SliceID: "full", Sequence: 0},
		},
	}, nil
}

type sliceStats struct {
	staged   int64
	bytes    int64
	written  int64
	stageRef string
	batches  int
}

func (m *Manager) executeSlice(ctx context.Context, provider staging.Provider, src endpoint.SourceEndpoint, slice *endpoint.IngestionSlice, datasetID, templateID, endpointID, opID string) (sliceStats, error) {
	var stats sliceStats
	var err error

	var iter endpoint.Iterator[endpoint.Record]
	if slicer, ok := src.(endpoint.SliceCapable); ok && slice != nil {
		iter, err = slicer.ReadSlice(ctx, &endpoint.SliceReadRequest{
			DatasetID: datasetID,
			Slice:     slice,
		})
	} else {
		iter, err = src.Read(ctx, &endpoint.ReadRequest{DatasetID: datasetID})
	}
	if err != nil {
		return stats, err
	}
	defer iter.Close()

	stageID := fmt.Sprintf("%s-%s", opID, slice.SliceID)
	var stageRef string
	var batchRefs []string
	batchSeq := 0
	chunk := make([]staging.RecordEnvelope, 0, 1000)

	flush := func() error {
		if len(chunk) == 0 {
			return nil
		}
		res, putErr := provider.PutBatch(ctx, &staging.PutBatchRequest{
			StageRef: stageRef,
			StageID:  stageID,
			SliceID:  slice.SliceID,
			BatchSeq: batchSeq,
			Records:  chunk,
		})
		if putErr != nil {
			return putErr
		}
		stageRef = res.StageRef
		batchRefs = append(batchRefs, res.BatchRef)
		stats.bytes += res.Stats.Bytes
		stats.staged += int64(len(chunk))
		batchSeq++
		chunk = chunk[:0]
		return nil
	}

	for iter.Next() {
		record := iter.Value()
		if record == nil {
			continue
		}

		entityKind := datasetID
		tenantID := ""
		projectKey := ""
		sourceURL := ""
		externalID := ""

		payload := make(endpoint.Record, len(record))
		for k, v := range record {
			switch strings.ToLower(k) {
			case "_entity", "_entitykind", "__entity":
				if s, ok := v.(string); ok && s != "" {
					entityKind = s
				}
			case "_tenantid", "tenantid":
				tenantID = fmt.Sprint(v)
			case "_projectkey", "projectkey":
				projectKey = fmt.Sprint(v)
			case "_sourceurl", "sourceurl":
				sourceURL = fmt.Sprint(v)
			case "_externalid", "externalid":
				externalID = fmt.Sprint(v)
			default:
				payload[k] = v
			}
		}
		if entityKind == "" {
			entityKind = datasetID
		}

		chunk = append(chunk, staging.RecordEnvelope{
			RecordKind: "raw",
			EntityKind: entityKind,
			Source: staging.SourceRef{
				EndpointID:   endpointID,
				SourceFamily: templateID,
				SourceID:     datasetID,
				URL:          sourceURL,
				ExternalID:   externalID,
			},
			TenantID:   tenantID,
			ProjectKey: projectKey,
			Payload:    payload,
			ObservedAt: time.Now().UTC().Format(time.RFC3339),
		})
		if len(chunk) >= cap(chunk) {
			if err := flush(); err != nil {
				return stats, err
			}
		}
	}
	if err := iter.Err(); err != nil {
		return stats, err
	}
	if err := flush(); err != nil {
		return stats, err
	}
	stats.stageRef = stageRef
	stats.batches = len(batchRefs)

	// Sink step: read batches back and count persisted records.
	for _, ref := range batchRefs {
		recs, getErr := provider.GetBatch(ctx, stageRef, ref)
		if getErr != nil {
			return stats, getErr
		}
		stats.written += int64(len(recs))
	}

	if stageRef != "" {
		_ = provider.FinalizeStage(ctx, stageRef)
	}

	return stats, nil
}

func (m *Manager) selectProvider(plan *endpoint.IngestionPlan, params map[string]string) (staging.Provider, error) {
	registry := staging.NewRegistry(staging.NewMemoryProvider(staging.DefaultMemoryCapBytes))

	preferred := staging.ProviderMinIO

	minioProvider, minioErr := buildMinioProvider(params, true)
	if minioErr != nil {
		return nil, minioErr
	}
	if minioProvider == nil {
		return nil, &staging.Error{
			Code:      staging.CodeStagingUnavailable,
			Retryable: false,
			Err:       fmt.Errorf("MinIO staging is required but not configured"),
		}
	}
	registry.Register(minioProvider)

	provider, ok := registry.Get(preferred)
	if !ok || provider == nil {
		return nil, &staging.Error{
			Code:      staging.CodeStagingUnavailable,
			Retryable: false,
			Err:       fmt.Errorf("MinIO staging is required but not available"),
		}
	}
	return provider, nil
}

func (m *Manager) markSucceeded(opID string) {
	m.updateState(opID, func(state *pb.OperationState) {
		state.Status = pb.OperationStatus_SUCCEEDED
		state.CompletedAt = time.Now().UnixMilli()
		state.Retryable = false
	})
}

func (m *Manager) failOperation(opID, code string, err error, retryable bool) {
	m.updateState(opID, func(state *pb.OperationState) {
		state.Status = pb.OperationStatus_FAILED
		state.CompletedAt = time.Now().UnixMilli()
		state.Retryable = retryable
		state.Error = &pb.ErrorDetail{
			Code:      code,
			Message:   err.Error(),
			Retryable: retryable,
		}
	})
}

func (m *Manager) saveState(state *pb.OperationState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ops[state.OperationId] = clone(state)
}

func (m *Manager) updateState(id string, mutate func(*pb.OperationState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.ops[id]
	if !ok {
		return
	}
	mutate(state)
	m.ops[id] = state
}

func (m *Manager) cloneState(id string) *pb.OperationState {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.ops[id]
	if !ok {
		return nil
	}
	return clone(state)
}

func setStat(state *pb.OperationState, key string, value any) {
	if state.Stats == nil {
		state.Stats = map[string]string{}
	}
	state.Stats[key] = fmt.Sprint(value)
}

func clone(state *pb.OperationState) *pb.OperationState {
	if state == nil {
		return nil
	}
	cloned := *state
	if state.Stats != nil {
		cloned.Stats = make(map[string]string, len(state.Stats))
		for k, v := range state.Stats {
			cloned.Stats[k] = v
		}
	}
	return &cloned
}

func buildSourceEndpoint(req *pb.StartOperationRequest) (endpoint.SourceEndpoint, string, error) {
	params := normalizeParameters(req.Parameters)
	ep, err := endpoint.CreateSource(req.TemplateId, params)
	if err != nil {
		return nil, "", err
	}
	datasetID := params["dataset_id"]
	if datasetID == nil {
		datasetID = params["datasetId"]
	}
	ds := fmt.Sprint(datasetID)
	if ds == "" {
		ds = "dataset"
	}
	return ep, ds, nil
}

func normalizeParameters(params map[string]string) map[string]any {
	out := make(map[string]any, len(params))
	for k, v := range params {
		key := k
		switch strings.ToLower(key) {
		case "projects", "project_keys", "spaces":
			if parts := strings.Split(v, ","); len(parts) > 1 {
				var trimmed []string
				for _, p := range parts {
					if t := strings.TrimSpace(p); t != "" {
						trimmed = append(trimmed, t)
					}
				}
				out[key] = trimmed
				continue
			}
		}

		if iv, err := strconv.Atoi(v); err == nil {
			out[key] = iv
			continue
		}
		if strings.EqualFold(v, "true") || strings.EqualFold(v, "false") {
			out[key] = strings.EqualFold(v, "true")
			continue
		}
		out[key] = v
	}
	return out
}

func buildMinioProvider(params map[string]string, force bool) (staging.Provider, error) {
	cfgParams := map[string]any{}
	copyParam := func(target string, keys ...string) {
		for _, key := range keys {
			if v, ok := params[key]; ok && v != "" {
				cfgParams[target] = v
				return
			}
		}
	}

	copyParam("endpointUrl", "staging_endpoint_url", "stagingEndpointUrl", "minio_endpoint_url")
	copyParam("accessKeyId", "staging_access_key_id", "stagingAccessKeyId", "staging_accessKeyId")
	copyParam("secretAccessKey", "staging_secret_access_key", "stagingSecretAccessKey", "staging_secretKey")
	copyParam("bucket", "staging_bucket", "stagingBucket")
	copyParam("basePrefix", "staging_base_prefix", "stagingBasePrefix")
	copyParam("tenantId", "staging_tenant_id", "tenant_id", "tenantId")
	copyParam("rootPath", "staging_root_path", "stagingRootPath")

	if _, ok := cfgParams["endpointUrl"]; !ok {
		if v := os.Getenv("MINIO_ENDPOINT"); v != "" {
			cfgParams["endpointUrl"] = v
		}
	}
	if _, ok := cfgParams["accessKeyId"]; !ok {
		if v := os.Getenv("MINIO_ACCESS_KEY"); v != "" {
			cfgParams["accessKeyId"] = v
		}
	}
	if _, ok := cfgParams["secretAccessKey"]; !ok {
		if v := os.Getenv("MINIO_SECRET_KEY"); v != "" {
			cfgParams["secretAccessKey"] = v
		}
	}
	if _, ok := cfgParams["bucket"]; !ok {
		if v := os.Getenv("MINIO_BUCKET"); v != "" {
			cfgParams["bucket"] = v
		}
	}
	if _, ok := cfgParams["basePrefix"]; !ok {
		if v := os.Getenv("MINIO_STAGE_PREFIX"); v != "" {
			cfgParams["basePrefix"] = v
		}
	}
	if _, ok := cfgParams["tenantId"]; !ok {
		if v := os.Getenv("TENANT_ID"); v != "" {
			cfgParams["tenantId"] = v
		}
	}

	if !force && len(cfgParams) == 0 {
		return nil, nil
	}

	cfg := minio.ParseConfig(cfgParams)
	if validation := cfg.Validate(); validation != nil && !validation.Valid {
		return nil, &staging.Error{
			Code:      staging.CodeStagingUnavailable,
			Retryable: validation.Retryable,
			Err:       fmt.Errorf("MinIO staging is required: %s", validation.Message),
		}
	}

	return minio.NewStagingProvider(cfg, nil)
}

func paramInt(params map[string]string, keys ...string) int {
	for _, key := range keys {
		if v, ok := params[key]; ok {
			if iv, err := strconv.Atoi(v); err == nil {
				return iv
			}
		}
	}
	return 0
}

func paramBool(params map[string]string, defaultVal bool, keys ...string) bool {
	for _, key := range keys {
		if v, ok := params[key]; ok {
			if strings.EqualFold(v, "true") {
				return true
			}
			if strings.EqualFold(v, "false") {
				return false
			}
		}
	}
	return defaultVal
}

func toInt64(val any) (int64, bool) {
	switch v := val.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		return int64(v), true
	case string:
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func classifyError(err error) (string, bool) {
	var se staging.CodedError
	if errors.As(err, &se) {
		return se.CodeValue(), se.RetryableStatus()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "E_TIMEOUT", true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unreachable") {
		return "E_ENDPOINT_UNREACHABLE", true
	}
	if strings.Contains(msg, "timeout") {
		return "E_TIMEOUT", true
	}
	if strings.Contains(msg, "auth") {
		return "E_AUTH_INVALID", false
	}
	return "E_UNKNOWN", true
}
