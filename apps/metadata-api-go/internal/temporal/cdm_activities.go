// Package temporal provides CDM sink activities.
// These activities handle writing records to CDM (Common Data Model) sinks.
package temporal

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/google/uuid"
	"github.com/nucleus/metadata-api/internal/database"
)

// CDMSinkActivities handles CDM sink operations.
type CDMSinkActivities struct {
	db *database.Client
}

// NewCDMSinkActivities creates a new CDMSinkActivities instance.
func NewCDMSinkActivities(db *database.Client) *CDMSinkActivities {
	return &CDMSinkActivities{db: db}
}

// =============================================================================
// PERSIST INGESTION BATCHES
// =============================================================================

// PersistIngestionBatchesInput is the input for PersistIngestionBatches.
type PersistIngestionBatchesInput struct {
	EndpointID     string                   `json:"endpointId"`
	UnitID         string                   `json:"unitId"`
	SinkID         string                   `json:"sinkId"`
	RunID          string                   `json:"runId"`
	Staging        []StagingHandle          `json:"staging,omitempty"`
	Records        []map[string]interface{} `json:"records,omitempty"`
	Stats          map[string]interface{}   `json:"stats,omitempty"`
	SinkEndpointID string                   `json:"sinkEndpointId,omitempty"`
	DataMode       string                   `json:"dataMode,omitempty"`
	CDMModelID     string                   `json:"cdmModelId,omitempty"`
}

// StagingHandle represents a staged file handle.
type StagingHandle struct {
	Path       string `json:"path"`
	ProviderID string `json:"providerId,omitempty"`
}

// PersistIngestionBatches processes and persists ingestion batches to sinks.
func (a *CDMSinkActivities) PersistIngestionBatches(ctx context.Context, input PersistIngestionBatchesInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("persisting ingestion batches",
		"endpointId", input.EndpointID,
		"unitId", input.UnitID,
		"sinkId", input.SinkID,
		"stagingCount", len(input.Staging),
		"recordCount", len(input.Records),
	)

	// Route based on sink type
	switch input.SinkID {
	case "kb", "knowledge_base":
		return a.persistToKB(ctx, input)
	case "cdm":
		return a.persistToCDM(ctx, input)
	default:
		return a.persistToGeneric(ctx, input)
	}
}

// persistToKB writes records to the Knowledge Base graph.
func (a *CDMSinkActivities) persistToKB(ctx context.Context, input PersistIngestionBatchesInput) error {
	logger := activity.GetLogger(ctx)

	// Load records from staging if needed
	records := input.Records
	if len(records) == 0 && len(input.Staging) > 0 {
		loaded, err := a.loadFromStaging(ctx, input.Staging)
		if err != nil {
			logger.Warn("failed to load from staging", "error", err)
			return err
		}
		records = loaded
	}

	if len(records) == 0 {
		logger.Info("no records to persist")
		return nil
	}

	// Determine tenant from endpoint
	endpoint, err := a.db.GetEndpoint(ctx, input.EndpointID)
	if err != nil {
		return fmt.Errorf("failed to get endpoint: %w", err)
	}

	tenantID := "default"
	if endpoint != nil && endpoint.ProjectID.Valid {
		tenantID = endpoint.ProjectID.String
	}

	// Process each record as a graph node
	for _, rec := range records {
		node := a.recordToGraphNode(tenantID, input, rec)
		if node == nil {
			continue
		}

		if _, err := a.db.UpsertGraphNode(ctx, node); err != nil {
			logger.Warn("failed to upsert node", "logicalKey", node.LogicalKey, "error", err)
		}
	}

	logger.Info("persisted to KB", "count", len(records))
	return nil
}

// persistToCDM writes records using CDM model mapping.
func (a *CDMSinkActivities) persistToCDM(ctx context.Context, input PersistIngestionBatchesInput) error {
	logger := activity.GetLogger(ctx)

	records := input.Records
	if len(records) == 0 && len(input.Staging) > 0 {
		loaded, err := a.loadFromStaging(ctx, input.Staging)
		if err != nil {
			return err
		}
		records = loaded
	}

	if len(records) == 0 {
		logger.Info("no CDM records to persist")
		return nil
	}

	// Map to CDM domain and persist as metadata records
	domain := input.CDMModelID
	if domain == "" {
		domain = "cdm.entity"
	}

	for _, rec := range records {
		id := getStringField(rec, "id", uuid.New().String())
		projectID := getStringField(rec, "projectId", "global")

		payload, _ := json.Marshal(rec)
		_, err := a.db.UpsertRecord(ctx, &database.MetadataRecord{
			ID:        id,
			ProjectID: projectID,
			Domain:    domain,
			Labels:    []string{fmt.Sprintf("sink:%s", input.SinkID), fmt.Sprintf("endpoint:%s", input.EndpointID)},
			Payload:   payload,
		})
		if err != nil {
			logger.Warn("failed to persist CDM record", "id", id, "error", err)
		}
	}

	logger.Info("persisted to CDM", "count", len(records), "model", domain)
	return nil
}

// persistToGeneric handles unknown sinks.
func (a *CDMSinkActivities) persistToGeneric(ctx context.Context, input PersistIngestionBatchesInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("generic sink handler", "sinkId", input.SinkID)

	// For generic sinks, just persist as metadata records
	records := input.Records
	if len(records) == 0 && len(input.Staging) > 0 {
		loaded, err := a.loadFromStaging(ctx, input.Staging)
		if err != nil {
			return err
		}
		records = loaded
	}

	for _, rec := range records {
		id := getStringField(rec, "id", uuid.New().String())
		projectID := getStringField(rec, "projectId", "global")
		domain := fmt.Sprintf("sink.%s", input.SinkID)

		payload, _ := json.Marshal(rec)
		_, err := a.db.UpsertRecord(ctx, &database.MetadataRecord{
			ID:        id,
			ProjectID: projectID,
			Domain:    domain,
			Payload:   payload,
		})
		if err != nil {
			logger.Warn("failed to persist record", "id", id, "error", err)
		}
	}

	return nil
}

func (a *CDMSinkActivities) loadFromStaging(ctx context.Context, handles []StagingHandle) ([]map[string]interface{}, error) {
	var allRecords []map[string]interface{}

	for _, h := range handles {
		records, err := loadRecordsFromFile(h.Path)
		if err != nil {
			return nil, err
		}
		allRecords = append(allRecords, records...)
	}

	return allRecords, nil
}

func (a *CDMSinkActivities) recordToGraphNode(tenantID string, input PersistIngestionBatchesInput, rec map[string]interface{}) *database.GraphNode {
	entityType := getStringField(rec, "entityType", getStringField(rec, "type", "entity"))
	displayName := getStringField(rec, "displayName", getStringField(rec, "name", ""))
	if displayName == "" {
		displayName = getStringField(rec, "id", "unknown")
	}

	logicalKey := getStringField(rec, "logicalKey", "")
	if logicalKey == "" {
		logicalKey = fmt.Sprintf("%s:%s:%s", tenantID, entityType, getStringField(rec, "id", uuid.New().String()))
	}

	properties, _ := json.Marshal(rec)

	node := &database.GraphNode{
		ID:          uuid.New().String(),
		TenantID:    tenantID,
		EntityType:  entityType,
		DisplayName: displayName,
		Properties:  properties,
		Version:     1,
		LogicalKey:  logicalKey,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if projectID := getStringField(rec, "projectId", ""); projectID != "" {
		node.ProjectID.String = projectID
		node.ProjectID.Valid = true
	}
	if canonicalPath := getStringField(rec, "canonicalPath", ""); canonicalPath != "" {
		node.CanonicalPath.String = canonicalPath
		node.CanonicalPath.Valid = true
	}
	if sourceSystem := getStringField(rec, "sourceSystem", input.EndpointID); sourceSystem != "" {
		node.SourceSystem.String = sourceSystem
		node.SourceSystem.Valid = true
	}

	return node
}

func getStringField(m map[string]interface{}, key, defaultVal string) string {
	if v, ok := m[key].(string); ok && v != "" {
		return v
	}
	return defaultVal
}
