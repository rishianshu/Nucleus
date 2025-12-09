// Package temporal provides Temporal activity implementations for the metadata-api.
// Note: Core collection/ingestion activities are in github.com/nucleus/ucl-worker/internal/activities
// This file contains additional activities specific to the metadata API orchestration.
package temporal

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/google/uuid"
	"github.com/nucleus/metadata-api/internal/database"
)

// MetadataActivities holds the activity implementations.
type MetadataActivities struct {
	db *database.Client
}

// NewMetadataActivities creates a new MetadataActivities instance.
func NewMetadataActivities(db *database.Client) *MetadataActivities {
	return &MetadataActivities{db: db}
}

// =============================================================================
// COLLECTION RUN ACTIVITIES
// =============================================================================

// CreateCollectionRunInput is the input for CreateCollectionRun.
type CreateCollectionRunInput struct {
	EndpointID   string `json:"endpointId"`
	CollectionID string `json:"collectionId,omitempty"`
	RequestedBy  string `json:"requestedBy,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// CreateCollectionRunOutput is the output for CreateCollectionRun.
type CreateCollectionRunOutput struct {
	RunID string `json:"runId"`
}

// CreateCollectionRun creates a new collection run record.
func (a *MetadataActivities) CreateCollectionRun(ctx context.Context, input CreateCollectionRunInput) (*CreateCollectionRunOutput, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("creating collection run", "endpointId", input.EndpointID)

	var collectionID *string
	if input.CollectionID != "" {
		collectionID = &input.CollectionID
	}

	requestedBy := input.RequestedBy
	if requestedBy == "" {
		requestedBy = input.Reason
	}

	run, err := a.db.CreateCollectionRun(ctx, input.EndpointID, collectionID, &requestedBy)
	if err != nil {
		return nil, fmt.Errorf("failed to create collection run: %w", err)
	}

	return &CreateCollectionRunOutput{RunID: run.ID}, nil
}

// MarkRunStartedInput is the input for MarkRunStarted.
type MarkRunStartedInput struct {
	RunID         string `json:"runId"`
	WorkflowID    string `json:"workflowId"`
	TemporalRunID string `json:"temporalRunId"`
}

// MarkRunStarted marks a collection run as started.
func (a *MetadataActivities) MarkRunStarted(ctx context.Context, input MarkRunStartedInput) error {
	return a.db.MarkRunStarted(ctx, input.RunID, input.WorkflowID, input.TemporalRunID)
}

// MarkRunCompletedInput is the input for MarkRunCompleted.
type MarkRunCompletedInput struct {
	RunID string `json:"runId"`
}

// MarkRunCompleted marks a collection run as completed.
func (a *MetadataActivities) MarkRunCompleted(ctx context.Context, input MarkRunCompletedInput) error {
	return a.db.MarkRunCompleted(ctx, input.RunID)
}

// MarkRunSkippedInput is the input for MarkRunSkipped.
type MarkRunSkippedInput struct {
	RunID  string `json:"runId"`
	Reason string `json:"reason"`
}

// MarkRunSkipped marks a collection run as skipped.
func (a *MetadataActivities) MarkRunSkipped(ctx context.Context, input MarkRunSkippedInput) error {
	return a.db.MarkRunSkipped(ctx, input.RunID, input.Reason)
}

// MarkRunFailedInput is the input for MarkRunFailed.
type MarkRunFailedInput struct {
	RunID string `json:"runId"`
	Error string `json:"error"`
}

// MarkRunFailed marks a collection run as failed.
func (a *MetadataActivities) MarkRunFailed(ctx context.Context, input MarkRunFailedInput) error {
	return a.db.MarkRunFailed(ctx, input.RunID, input.Error)
}

// =============================================================================
// PREPARE COLLECTION JOB
// =============================================================================

// PrepareCollectionJobInput is the input for PrepareCollectionJob.
type PrepareCollectionJobInput struct {
	RunID string `json:"runId"`
}

// CollectionJobPlan is the output for PrepareCollectionJob.
type CollectionJobPlan struct {
	Kind       string                 `json:"kind"` // "run" or "skip"
	Reason     string                 `json:"reason,omitempty"`
	Capability string                 `json:"capability,omitempty"`
	Job        *CollectionJobRequest  `json:"job,omitempty"`
}

// CollectionJobRequest describes a collection job to execute.
type CollectionJobRequest struct {
	RunID         string                 `json:"runId"`
	EndpointID    string                 `json:"endpointId"`
	SourceID      string                 `json:"sourceId"`
	EndpointName  string                 `json:"endpointName"`
	ConnectionURL string                 `json:"connectionUrl"`
	Schemas       []string               `json:"schemas,omitempty"`
	ProjectID     string                 `json:"projectId,omitempty"`
	Labels        []string               `json:"labels,omitempty"`
	Config        map[string]interface{} `json:"config,omitempty"`
}

// PrepareCollectionJob prepares a collection job from a run ID.
func (a *MetadataActivities) PrepareCollectionJob(ctx context.Context, input PrepareCollectionJobInput) (*CollectionJobPlan, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("preparing collection job", "runId", input.RunID)

	// Get run and endpoint
	run, err := a.db.GetCollectionRun(ctx, input.RunID)
	if err != nil {
		return nil, fmt.Errorf("failed to get collection run: %w", err)
	}
	if run == nil {
		return nil, fmt.Errorf("collection run %s not found", input.RunID)
	}

	endpoint, err := a.db.GetEndpoint(ctx, run.EndpointID)
	if err != nil {
		return nil, fmt.Errorf("failed to get endpoint: %w", err)
	}
	if endpoint == nil {
		return nil, fmt.Errorf("endpoint not found")
	}

	if endpoint.URL == "" {
		return nil, fmt.Errorf("endpoint missing connection URL")
	}

	// Check capabilities
	capabilities := endpoint.Capabilities
	if len(capabilities) > 0 && !contains(capabilities, "metadata") {
		return &CollectionJobPlan{
			Kind:       "skip",
			Capability: "metadata",
			Reason:     fmt.Sprintf("Collection skipped: %s does not expose the \"metadata\" capability.", endpoint.Name),
		}, nil
	}

	// Parse config and schemas
	var config map[string]interface{}
	if len(endpoint.Config) > 0 {
		_ = json.Unmarshal(endpoint.Config, &config)
	}

	schemas := resolveSchemas(run, config)
	sourceID := endpoint.SourceID.String
	if sourceID == "" {
		sourceID = endpoint.ID
	}

	projectID := ""
	if endpoint.ProjectID.Valid {
		projectID = endpoint.ProjectID.String
	}

	return &CollectionJobPlan{
		Kind: "run",
		Job: &CollectionJobRequest{
			RunID:         run.ID,
			EndpointID:    endpoint.ID,
			SourceID:      sourceID,
			EndpointName:  endpoint.Name,
			ConnectionURL: endpoint.URL,
			Schemas:       schemas,
			ProjectID:     projectID,
			Labels:        endpoint.Labels,
			Config:        config,
		},
	}, nil
}

// =============================================================================
// PERSIST CATALOG RECORDS
// =============================================================================

// PersistCatalogRecordsInput is the input for PersistCatalogRecords.
type PersistCatalogRecordsInput struct {
	RunID       string                   `json:"runId"`
	Records     []map[string]interface{} `json:"records,omitempty"`
	RecordsPath string                   `json:"recordsPath,omitempty"`
}

// PersistCatalogRecords persists collected catalog records.
func (a *MetadataActivities) PersistCatalogRecords(ctx context.Context, input PersistCatalogRecordsInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("persisting catalog records", "runId", input.RunID)

	// Load records from file if path provided
	records := input.Records
	if len(records) == 0 && input.RecordsPath != "" {
		loaded, err := loadRecordsFromFile(input.RecordsPath)
		if err != nil {
			logger.Warn("failed to load records from file", "path", input.RecordsPath, "error", err)
		} else {
			records = loaded
		}
		// Clean up temp file
		_ = os.Remove(input.RecordsPath)
	}

	if len(records) == 0 {
		logger.Info("no records to persist")
		return nil
	}

	// Get run and endpoint for defaults
	run, err := a.db.GetCollectionRun(ctx, input.RunID)
	if err != nil {
		return fmt.Errorf("failed to get collection run: %w", err)
	}

	endpoint, err := a.db.GetEndpoint(ctx, run.EndpointID)
	if err != nil {
		return fmt.Errorf("failed to get endpoint: %w", err)
	}

	defaultProject := os.Getenv("METADATA_DEFAULT_PROJECT")
	if defaultProject == "" {
		defaultProject = "global"
	}

	// Persist each record
	for _, record := range records {
		id := getString(record, "id")
		if id == "" {
			id = uuid.New().String()
		}

		projectID := getString(record, "projectId")
		if projectID == "" && endpoint.ProjectID.Valid {
			projectID = endpoint.ProjectID.String
		}
		if projectID == "" {
			projectID = defaultProject
		}

		// Ensure project exists
		_, err := a.db.GetOrCreateProject(ctx, projectID)
		if err != nil {
			logger.Warn("failed to create project", "projectId", projectID, "error", err)
		}

		domain := getString(record, "domain")
		if domain == "" {
			domain = "catalog.dataset"
		}

		labels := getStringSlice(record, "labels")
		labels = append(labels, fmt.Sprintf("endpoint:%s", endpoint.ID))
		if endpoint.SourceID.Valid {
			labels = append(labels, fmt.Sprintf("source:%s", endpoint.SourceID.String))
		}

		payload, _ := json.Marshal(record["payload"])

		_, err = a.db.UpsertRecord(ctx, &database.MetadataRecord{
			ID:        id,
			ProjectID: projectID,
			Domain:    domain,
			Labels:    labels,
			Payload:   payload,
		})
		if err != nil {
			logger.Warn("failed to persist record", "id", id, "error", err)
		}
	}

	logger.Info("persisted catalog records", "count", len(records))
	return nil
}

// =============================================================================
// INGESTION ACTIVITIES
// =============================================================================

// StartIngestionRunInput is the input for StartIngestionRun.
type StartIngestionRunInput struct {
	EndpointID string `json:"endpointId"`
	UnitID     string `json:"unitId"`
	SinkID     string `json:"sinkId,omitempty"`
}

// StartIngestionRunOutput is the output for StartIngestionRun.
type StartIngestionRunOutput struct {
	RunID                 string                 `json:"runId"`
	SinkID                string                 `json:"sinkId"`
	VendorKey             string                 `json:"vendorKey"`
	Checkpoint            map[string]interface{} `json:"checkpoint"`
	CheckpointVersion     string                 `json:"checkpointVersion"`
	StagingProviderID     string                 `json:"stagingProviderId"`
	Policy                map[string]interface{} `json:"policy"`
	Mode                  string                 `json:"mode"`
	DataMode              string                 `json:"dataMode"`
	SinkEndpointID        string                 `json:"sinkEndpointId"`
	CDMModelID            string                 `json:"cdmModelId"`
	Filter                map[string]interface{} `json:"filter"`
	TransientState        map[string]interface{} `json:"transientState"`
	TransientStateVersion string                 `json:"transientStateVersion"`
}

// StartIngestionRun initializes an ingestion run.
func (a *MetadataActivities) StartIngestionRun(ctx context.Context, input StartIngestionRunInput) (*StartIngestionRunOutput, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("starting ingestion run", "endpointId", input.EndpointID, "unitId", input.UnitID)

	// Get endpoint
	endpoint, err := a.db.GetEndpoint(ctx, input.EndpointID)
	if err != nil {
		return nil, fmt.Errorf("failed to get endpoint: %w", err)
	}
	if endpoint == nil {
		return nil, fmt.Errorf("endpoint %s not found", input.EndpointID)
	}

	// Resolve sink ID
	sinkID := input.SinkID
	if sinkID == "" {
		sinkID = os.Getenv("INGESTION_DEFAULT_SINK")
		if sinkID == "" {
			sinkID = "kb"
		}
	}

	// Get ingestion config if exists
	config, err := a.db.GetIngestionUnitConfig(ctx, input.EndpointID, input.UnitID)
	if err != nil {
		logger.Warn("failed to get ingestion config", "error", err)
	}

	// Build vendor key
	vendorKey := endpoint.Domain.String
	if vendorKey == "" {
		vendorKey = endpoint.SourceID.String
	}
	if vendorKey == "" {
		vendorKey = endpoint.ID
	}

	// Parse endpoint config
	var endpointConfig map[string]interface{}
	if len(endpoint.Config) > 0 {
		_ = json.Unmarshal(endpoint.Config, &endpointConfig)
	}

	// Resolve policy
	var policy map[string]interface{}
	if config != nil && len(config.Policy) > 0 {
		_ = json.Unmarshal(config.Policy, &policy)
	}
	if policy == nil {
		policy = endpointConfig
	}

	// Merge endpoint parameters into policy
	if params, ok := endpointConfig["parameters"].(map[string]interface{}); ok {
		if policy == nil {
			policy = make(map[string]interface{})
		}
		policyParams, _ := policy["parameters"].(map[string]interface{})
		if policyParams == nil {
			policyParams = make(map[string]interface{})
		}
		for k, v := range params {
			if _, exists := policyParams[k]; !exists {
				policyParams[k] = v
			}
		}
		policy["parameters"] = policyParams
	}

	// Resolve staging provider
	stagingProvider := os.Getenv("INGESTION_DEFAULT_STAGING_PROVIDER")
	if stagingProvider == "" {
		stagingProvider = "in_memory"
	}
	if sp, ok := endpointConfig["stagingProvider"].(string); ok && sp != "" {
		stagingProvider = sp
	}

	// Get checkpoint and transient state
	checkpoint, checkpointVersion, err := a.db.GetIngestionCheckpoint(ctx, input.EndpointID, input.UnitID, sinkID, vendorKey)
	if err != nil {
		logger.Warn("failed to get checkpoint", "error", err)
	}

	transientState, transientStateVersion, err := a.db.GetTransientState(ctx, input.EndpointID, input.UnitID, sinkID)
	if err != nil {
		logger.Warn("failed to get transient state", "error", err)
	}

	// Parse filter from config
	var filter map[string]interface{}
	if config != nil && len(config.Filter) > 0 {
		_ = json.Unmarshal(config.Filter, &filter)
	}

	// Generate run ID
	runID := uuid.New().String()

	// Update unit state to running
	err = a.db.UpsertIngestionUnitState(ctx, &database.IngestionUnitState{
		EndpointID: input.EndpointID,
		UnitID:     input.UnitID,
		SinkID:     sinkID,
		State:      database.IngestionStateRunning,
		LastRunID:  database.ToNullString(runID),
		LastRunAt:  database.ToNullTime(time.Now()),
	})
	if err != nil {
		logger.Warn("failed to update unit state", "error", err)
	}

	var mode, dataMode, sinkEndpointID, cdmModelID string
	if config != nil {
		mode = config.RunMode
		dataMode = config.Mode
		if config.SinkEndpointID.Valid {
			sinkEndpointID = config.SinkEndpointID.String
		}
	}

	return &StartIngestionRunOutput{
		RunID:                 runID,
		SinkID:                sinkID,
		VendorKey:             vendorKey,
		Checkpoint:            checkpoint,
		CheckpointVersion:     checkpointVersion,
		StagingProviderID:     stagingProvider,
		Policy:                policy,
		Mode:                  mode,
		DataMode:              dataMode,
		SinkEndpointID:        sinkEndpointID,
		CDMModelID:            cdmModelID,
		Filter:                filter,
		TransientState:        transientState,
		TransientStateVersion: transientStateVersion,
	}, nil
}

// CompleteIngestionRunInput is the input for CompleteIngestionRun.
type CompleteIngestionRunInput struct {
	EndpointID            string                 `json:"endpointId"`
	UnitID                string                 `json:"unitId"`
	SinkID                string                 `json:"sinkId"`
	VendorKey             string                 `json:"vendorKey"`
	RunID                 string                 `json:"runId"`
	CheckpointVersion     string                 `json:"checkpointVersion"`
	NewCheckpoint         interface{}            `json:"newCheckpoint"`
	Stats                 map[string]interface{} `json:"stats"`
	TransientStateVersion string                 `json:"transientStateVersion"`
	NewTransientState     map[string]interface{} `json:"newTransientState"`
}

// CompleteIngestionRun completes an ingestion run.
func (a *MetadataActivities) CompleteIngestionRun(ctx context.Context, input CompleteIngestionRunInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("completing ingestion run", "runId", input.RunID)

	// Save checkpoint
	checkpointData, _ := json.Marshal(map[string]interface{}{
		"cursor":    input.NewCheckpoint,
		"lastRunId": input.RunID,
		"stats":     input.Stats,
	})
	err := a.db.SaveIngestionCheckpoint(ctx, input.EndpointID, input.UnitID, input.SinkID, input.VendorKey, checkpointData, input.CheckpointVersion)
	if err != nil {
		logger.Warn("failed to save checkpoint", "error", err)
	}

	// Save transient state
	if input.NewTransientState != nil {
		transientData, _ := json.Marshal(input.NewTransientState)
		err = a.db.SaveTransientState(ctx, input.EndpointID, input.UnitID, input.SinkID, transientData, input.TransientStateVersion)
		if err != nil {
			logger.Warn("failed to save transient state", "error", err)
		}
	}

	// Update unit state
	statsData, _ := json.Marshal(input.Stats)
	err = a.db.UpsertIngestionUnitState(ctx, &database.IngestionUnitState{
		EndpointID: input.EndpointID,
		UnitID:     input.UnitID,
		SinkID:     input.SinkID,
		State:      database.IngestionStateSucceeded,
		LastRunID:  database.ToNullString(input.RunID),
		LastRunAt:  database.ToNullTime(time.Now()),
		Stats:      statsData,
	})
	if err != nil {
		return fmt.Errorf("failed to update unit state: %w", err)
	}

	return nil
}

// FailIngestionRunInput is the input for FailIngestionRun.
type FailIngestionRunInput struct {
	EndpointID string `json:"endpointId"`
	UnitID     string `json:"unitId"`
	SinkID     string `json:"sinkId"`
	VendorKey  string `json:"vendorKey"`
	RunID      string `json:"runId"`
	Error      string `json:"error"`
}

// FailIngestionRun marks an ingestion run as failed.
func (a *MetadataActivities) FailIngestionRun(ctx context.Context, input FailIngestionRunInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("failing ingestion run", "runId", input.RunID, "error", input.Error)

	// Sanitize error
	errorMsg := input.Error
	if len(errorMsg) > 500 {
		errorMsg = errorMsg[:500]
	}

	// Update unit state
	err := a.db.UpsertIngestionUnitState(ctx, &database.IngestionUnitState{
		EndpointID: input.EndpointID,
		UnitID:     input.UnitID,
		SinkID:     input.SinkID,
		State:      database.IngestionStateFailed,
		LastRunID:  database.ToNullString(input.RunID),
		LastRunAt:  database.ToNullTime(time.Now()),
		LastError:  database.ToNullString(errorMsg),
	})
	if err != nil {
		return fmt.Errorf("failed to update unit state: %w", err)
	}

	return nil
}

// =============================================================================
// LOAD STAGED RECORDS
// =============================================================================

// LoadStagedRecordsInput is the input for LoadStagedRecords.
type LoadStagedRecordsInput struct {
	Path              string `json:"path"`
	StagingProviderID string `json:"stagingProviderId,omitempty"`
}

// LoadStagedRecords loads records from a staged file.
func (a *MetadataActivities) LoadStagedRecords(ctx context.Context, input LoadStagedRecordsInput) ([]map[string]interface{}, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("loading staged records", "path", input.Path)

	records, err := loadRecordsFromFile(input.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to load staged records: %w", err)
	}

	// Clean up temp file
	_ = os.Remove(input.Path)

	return records, nil
}

// =============================================================================
// HELPERS
// =============================================================================

func resolveSchemas(run *database.MetadataCollectionRun, config map[string]interface{}) []string {
	// Try filters first
	if run != nil && len(run.Filters) > 0 {
		var filters map[string]interface{}
		if err := json.Unmarshal(run.Filters, &filters); err == nil {
			if schemas, ok := filters["schemas"].([]interface{}); ok && len(schemas) > 0 {
				return toStringSlice(schemas)
			}
		}
	}

	// Try endpoint config
	if config != nil {
		if schemas, ok := config["schemas"].([]interface{}); ok && len(schemas) > 0 {
			return toStringSlice(schemas)
		}
		if params, ok := config["parameters"].(map[string]interface{}); ok {
			if schemaStr, ok := params["schemas"].(string); ok && schemaStr != "" {
				return []string{schemaStr}
			}
		}
	}

	return []string{"public"}
}

func loadRecordsFromFile(path string) ([]map[string]interface{}, error) {
	absPath := filepath.Clean(path)
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}

	var records []map[string]interface{}
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getStringSlice(m map[string]interface{}, key string) []string {
	if v, ok := m[key].([]interface{}); ok {
		return toStringSlice(v)
	}
	return nil
}

func toStringSlice(v []interface{}) []string {
	result := make([]string, 0, len(v))
	for _, item := range v {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}
