// Package graph provides additional GraphQL resolvers for collections, ingestion, and KB queries.
package graph

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/nucleus/metadata-api/internal/auth"
	"github.com/nucleus/metadata-api/internal/database"
)

// =============================================================================
// COLLECTION QUERY RESOLVERS
// =============================================================================

// Collections returns collections with optional filtering.
func (r *queryResolver) Collections(ctx context.Context, endpointID *string, isEnabled *bool, first *int, after *string) ([]*MetadataCollection, error) {
	limit := 50
	if first != nil && *first > 0 {
		limit = *first
	}

	collections, err := r.db.ListCollections(ctx, endpointID, isEnabled, limit)
	if err != nil {
		return nil, err
	}

	result := make([]*MetadataCollection, len(collections))
	for i, col := range collections {
		result[i] = mapCollectionToGraphQL(col)
	}
	return result, nil
}

// Collection returns a single collection by ID.
func (r *queryResolver) Collection(ctx context.Context, id string) (*MetadataCollection, error) {
	col, err := r.db.GetCollection(ctx, id)
	if err != nil {
		return nil, err
	}
	if col == nil {
		return nil, nil
	}
	return mapCollectionToGraphQL(col), nil
}

// =============================================================================
// COLLECTION MUTATION RESOLVERS
// =============================================================================

// CreateCollection creates a new collection.
func (r *mutationResolver) CreateCollection(ctx context.Context, input CollectionCreateInput) (*MetadataCollection, error) {
	col := &database.MetadataCollection{
		EndpointID: input.EndpointID,
		IsEnabled:  true,
	}

	if input.ScheduleCron != nil {
		col.ScheduleCron.String = *input.ScheduleCron
		col.ScheduleCron.Valid = true
	}
	if input.ScheduleTimezone != nil {
		col.ScheduleTimezone = *input.ScheduleTimezone
	} else {
		col.ScheduleTimezone = "UTC"
	}
	if input.IsEnabled != nil {
		col.IsEnabled = *input.IsEnabled
	}

	result, err := r.db.CreateCollection(ctx, col)
	if err != nil {
		return nil, err
	}
	return mapCollectionToGraphQL(result), nil
}

// UpdateCollection updates a collection.
func (r *mutationResolver) UpdateCollection(ctx context.Context, id string, input CollectionUpdateInput) (*MetadataCollection, error) {
	updates := make(map[string]interface{})

	if input.ScheduleCron != nil {
		updates["schedule_cron"] = *input.ScheduleCron
	}
	if input.ScheduleTimezone != nil {
		updates["schedule_timezone"] = *input.ScheduleTimezone
	}
	if input.IsEnabled != nil {
		updates["is_enabled"] = *input.IsEnabled
	}

	result, err := r.db.UpdateCollection(ctx, id, updates)
	if err != nil {
		return nil, err
	}
	return mapCollectionToGraphQL(result), nil
}

// DeleteCollection deletes a collection.
func (r *mutationResolver) DeleteCollection(ctx context.Context, id string) (bool, error) {
	err := r.db.DeleteCollection(ctx, id)
	return err == nil, err
}

// =============================================================================
// INGESTION QUERY RESOLVERS
// =============================================================================

// IngestionStatuses returns ingestion statuses for an endpoint.
func (r *queryResolver) IngestionStatuses(ctx context.Context, endpointID string) ([]*IngestionStatus, error) {
	states, err := r.db.ListIngestionUnitStates(ctx, endpointID)
	if err != nil {
		return nil, err
	}

	result := make([]*IngestionStatus, len(states))
	for i, s := range states {
		result[i] = mapIngestionStateToGraphQL(s)
	}
	return result, nil
}

// IngestionStatus returns a single ingestion status.
func (r *queryResolver) IngestionStatus(ctx context.Context, endpointID, unitID string) (*IngestionStatus, error) {
	// Get default sink
	sinkID := "kb"
	state, err := r.db.GetIngestionUnitState(ctx, endpointID, unitID, sinkID)
	if err != nil {
		return nil, err
	}
	if state == nil {
		return nil, nil
	}
	return mapIngestionStateToGraphQL(state), nil
}

// IngestionUnitConfigs returns ingestion configs for an endpoint.
func (r *queryResolver) IngestionUnitConfigs(ctx context.Context, endpointID string) ([]*IngestionUnitConfig, error) {
	configs, err := r.db.ListIngestionUnitConfigs(ctx, endpointID)
	if err != nil {
		return nil, err
	}

	result := make([]*IngestionUnitConfig, len(configs))
	for i, c := range configs {
		result[i] = mapIngestionConfigToGraphQL(c)
	}
	return result, nil
}

// =============================================================================
// INGESTION MUTATION RESOLVERS
// =============================================================================

// StartIngestion starts an ingestion run.
func (r *mutationResolver) StartIngestion(ctx context.Context, endpointID, unitID string, sinkID *string, sinkEndpointID *string) (*IngestionActionResult, error) {
	// This should trigger a Temporal workflow
	// For now, return a placeholder
	runID := uuid.New().String()
	return &IngestionActionResult{
		OK:      true,
		RunID:   &runID,
		State:   IngestionStateRunning,
		Message: strPtr("Ingestion started"),
	}, nil
}

// PauseIngestion pauses an ingestion.
func (r *mutationResolver) PauseIngestion(ctx context.Context, endpointID, unitID string, sinkID *string) (*IngestionActionResult, error) {
	sid := "kb"
	if sinkID != nil {
		sid = *sinkID
	}

	err := r.db.UpsertIngestionUnitState(ctx, &database.IngestionUnitState{
		EndpointID: endpointID,
		UnitID:     unitID,
		SinkID:     sid,
		State:      database.IngestionStatePaused,
	})
	if err != nil {
		return &IngestionActionResult{OK: false, Message: strPtr(err.Error())}, nil
	}

	return &IngestionActionResult{
		OK:      true,
		State:   IngestionStatePaused,
		Message: strPtr("Ingestion paused"),
	}, nil
}

// ResetIngestionCheckpoint resets an ingestion checkpoint.
func (r *mutationResolver) ResetIngestionCheckpoint(ctx context.Context, endpointID, unitID string, sinkID *string) (*IngestionActionResult, error) {
	sid := "kb"
	if sinkID != nil {
		sid = *sinkID
	}

	// Reset checkpoint by saving empty data
	err := r.db.SaveIngestionCheckpoint(ctx, endpointID, unitID, sid, "", json.RawMessage(`{}`), "")
	if err != nil {
		return &IngestionActionResult{OK: false, Message: strPtr(err.Error())}, nil
	}

	return &IngestionActionResult{
		OK:      true,
		State:   IngestionStateIdle,
		Message: strPtr("Checkpoint reset"),
	}, nil
}

// ConfigureIngestionUnit configures an ingestion unit.
func (r *mutationResolver) ConfigureIngestionUnit(ctx context.Context, input IngestionUnitConfigInput) (*IngestionUnitConfig, error) {
	config := &database.IngestionUnitConfig{
		EndpointID: input.EndpointID,
		UnitID:     input.UnitID,
		DatasetID:  input.UnitID, // Default to unitID
		SinkID:     "kb",
	}

	if input.Enabled != nil {
		config.Enabled = *input.Enabled
	}
	if input.RunMode != nil {
		config.RunMode = *input.RunMode
	}
	if input.Mode != nil {
		config.Mode = *input.Mode
	}
	if input.SinkID != nil {
		config.SinkID = *input.SinkID
	}
	if input.ScheduleKind != nil {
		config.ScheduleKind = *input.ScheduleKind
	}
	if input.ScheduleIntervalMinutes != nil {
		config.ScheduleIntervalMinutes.Int32 = int32(*input.ScheduleIntervalMinutes)
		config.ScheduleIntervalMinutes.Valid = true
	}
	if input.Policy != nil {
		config.Policy = input.Policy
	}

	result, err := r.db.UpsertIngestionUnitConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return mapIngestionConfigToGraphQL(result), nil
}

// =============================================================================
// ENDPOINT TEMPLATES RESOLVER
// =============================================================================

// EndpointTemplates returns endpoint templates.
func (r *queryResolver) EndpointTemplates(ctx context.Context, family *MetadataEndpointFamily) ([]*MetadataEndpointTemplate, error) {
	// Get from database cache
	templates, err := r.db.ListEndpointTemplates(ctx)
	if err != nil {
		return nil, err
	}

	var filtered []*MetadataEndpointTemplate
	for _, t := range templates {
		if family != nil {
			templateFamily := t.Family
			if templateFamily != string(*family) {
				continue
			}
		}
		filtered = append(filtered, mapTemplateToGraphQL(t))
	}
	return filtered, nil
}

// MetadataEndpointTemplates is an alias for EndpointTemplates.
func (r *queryResolver) MetadataEndpointTemplates(ctx context.Context, family *MetadataEndpointFamily) ([]*MetadataEndpointTemplate, error) {
	return r.EndpointTemplates(ctx, family)
}

// =============================================================================
// CATALOG DATASET RESOLVERS
// =============================================================================

// CatalogDatasets returns catalog datasets.
func (r *queryResolver) CatalogDatasets(ctx context.Context, projectID *string, labels []string, search *string, endpointID *string, unlabeledOnly *bool) ([]*CatalogDataset, error) {
	authCtx := auth.FromContext(ctx)
	effectiveProjectID := projectID
	if effectiveProjectID == nil && authCtx.ProjectID != "" {
		effectiveProjectID = &authCtx.ProjectID
	}

	// Get records from catalog.dataset domain
	records, err := r.db.ListRecords(ctx, "catalog.dataset", effectiveProjectID, labels, search, 100)
	if err != nil {
		return nil, err
	}

	result := make([]*CatalogDataset, 0, len(records))
	for _, rec := range records {
		dataset := mapRecordToCatalogDataset(rec)
		if dataset == nil {
			continue
		}

		// Filter by endpoint if specified
		if endpointID != nil && dataset.SourceEndpointID != nil && *dataset.SourceEndpointID != *endpointID {
			continue
		}

		// Filter unlabeled if requested
		if unlabeledOnly != nil && *unlabeledOnly && len(dataset.Labels) > 0 {
			continue
		}

		result = append(result, dataset)
	}
	return result, nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func mapCollectionToGraphQL(col *database.MetadataCollection) *MetadataCollection {
	if col == nil {
		return nil
	}
	return &MetadataCollection{
		ID:                 col.ID,
		EndpointID:         col.EndpointID,
		ScheduleCron:       nullableStringPtr(col.ScheduleCron),
		ScheduleTimezone:   &col.ScheduleTimezone,
		IsEnabled:          col.IsEnabled,
		TemporalScheduleID: nullableStringPtr(col.TemporalScheduleID),
		CreatedAt:          col.CreatedAt,
		UpdatedAt:          col.UpdatedAt,
	}
}

func mapIngestionStateToGraphQL(s *database.IngestionUnitState) *IngestionStatus {
	if s == nil {
		return nil
	}
	var stats, checkpoint json.RawMessage
	stats = s.Stats
	checkpoint = s.Checkpoint

	return &IngestionStatus{
		EndpointID: s.EndpointID,
		UnitID:     s.UnitID,
		SinkID:     s.SinkID,
		State:      IngestionState(s.State),
		LastRunID:  nullableStringPtr(s.LastRunID),
		LastRunAt:  nullableTimePtr(s.LastRunAt),
		LastError:  nullableStringPtr(s.LastError),
		Stats:      stats,
		Checkpoint: checkpoint,
	}
}

func mapIngestionConfigToGraphQL(c *database.IngestionUnitConfig) *IngestionUnitConfig {
	if c == nil {
		return nil
	}
	return &IngestionUnitConfig{
		ID:                      c.ID,
		EndpointID:              c.EndpointID,
		DatasetID:               c.DatasetID,
		UnitID:                  c.UnitID,
		Enabled:                 c.Enabled,
		RunMode:                 c.RunMode,
		Mode:                    c.Mode,
		SinkID:                  c.SinkID,
		SinkEndpointID:          nullableStringPtr(c.SinkEndpointID),
		ScheduleKind:            c.ScheduleKind,
		ScheduleIntervalMinutes: nullableInt32Ptr(c.ScheduleIntervalMinutes),
		Policy:                  c.Policy,
	}
}

func mapTemplateToGraphQL(t *database.EndpointTemplate) *MetadataEndpointTemplate {
	if t == nil {
		return nil
	}
	family := MetadataEndpointFamily(t.Family)
	return &MetadataEndpointTemplate{
		ID:          t.ID,
		Family:      family,
		Title:       t.Title,
		Vendor:      t.Vendor,
		Description: nullableStringPtr(t.Description),
		Categories:  t.Categories,
	}
}

func mapRecordToCatalogDataset(rec *database.MetadataRecord) *CatalogDataset {
	if rec == nil {
		return nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Payload, &payload); err != nil {
		return nil
	}

	dataset := &CatalogDataset{
		ID:     rec.ID,
		Labels: rec.Labels,
	}

	// Extract common fields from payload
	if name, ok := payload["name"].(string); ok {
		dataset.DisplayName = name
	} else if displayName, ok := payload["displayName"].(string); ok {
		dataset.DisplayName = displayName
	} else {
		dataset.DisplayName = rec.ID
	}

	if desc, ok := payload["description"].(string); ok {
		dataset.Description = &desc
	}
	if source, ok := payload["source"].(string); ok {
		dataset.Source = &source
	}
	if schema, ok := payload["schema"].(string); ok {
		dataset.Schema = &schema
	}
	if entity, ok := payload["entity"].(string); ok {
		dataset.Entity = &entity
	}
	if sourceEndpointID, ok := payload["sourceEndpointId"].(string); ok {
		dataset.SourceEndpointID = &sourceEndpointID
	}

	return dataset
}

func strPtr(s string) *string {
	return &s
}

func nullableInt32Ptr(n database.NullableInt32) *int {
	if n.Valid {
		v := int(n.Int32)
		return &v
	}
	return nil
}
