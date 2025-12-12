// Package database provides additional queries for ingestion and checkpoint operations.
package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// NULLABLE TYPE HELPERS
// =============================================================================

// NullableString is an alias for sql.NullString.
type NullableString = sql.NullString

// NullableTime is an alias for sql.NullTime.
type NullableTime = sql.NullTime

// ToNullString creates a NullString from a string.
func ToNullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

// ToNullTime creates a NullTime from a time.
func ToNullTime(t time.Time) sql.NullTime {
	return sql.NullTime{Time: t, Valid: !t.IsZero()}
}

// =============================================================================
// COLLECTION RUN QUERIES
// =============================================================================

// GetCollectionRun retrieves a collection run by ID.
func (c *Client) GetCollectionRun(ctx context.Context, id string) (*MetadataCollectionRun, error) {
	var run MetadataCollectionRun
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, collection_id, status, requested_by, requested_at,
		       started_at, completed_at, workflow_id, temporal_run_id, error, filters
		FROM metadata_collection_runs
		WHERE id = $1
	`, id).Scan(
		&run.ID, &run.EndpointID, &run.CollectionID, &run.Status, &run.RequestedBy, &run.RequestedAt,
		&run.StartedAt, &run.CompletedAt, &run.WorkflowID, &run.TemporalRunID, &run.Error, &run.Filters,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get collection run: %w", err)
	}
	return &run, nil
}

// =============================================================================
// INGESTION UNIT CONFIG QUERIES
// =============================================================================

// GetIngestionUnitConfig retrieves an ingestion unit config.
func (c *Client) GetIngestionUnitConfig(ctx context.Context, endpointID, unitID string) (*IngestionUnitConfig, error) {
	var config IngestionUnitConfig
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, dataset_id, unit_id, enabled, run_mode, mode, sink_id,
		       sink_endpoint_id, schedule_kind, schedule_interval_minutes, policy, filter,
		       created_at, updated_at
		FROM ingestion_unit_configs
		WHERE endpoint_id = $1 AND unit_id = $2
	`, endpointID, unitID).Scan(
		&config.ID, &config.EndpointID, &config.DatasetID, &config.UnitID, &config.Enabled,
		&config.RunMode, &config.Mode, &config.SinkID, &config.SinkEndpointID,
		&config.ScheduleKind, &config.ScheduleIntervalMinutes, &config.Policy, &config.Filter,
		&config.CreatedAt, &config.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get ingestion config: %w", err)
	}
	return &config, nil
}

// UpsertIngestionUnitConfig creates or updates an ingestion unit config.
func (c *Client) UpsertIngestionUnitConfig(ctx context.Context, config *IngestionUnitConfig) (*IngestionUnitConfig, error) {
	if config.ID == "" {
		config.ID = uuid.New().String()
	}

	var result IngestionUnitConfig
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO ingestion_unit_configs (
			id, endpoint_id, dataset_id, unit_id, enabled, run_mode, mode, sink_id,
			sink_endpoint_id, schedule_kind, schedule_interval_minutes, policy, filter
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (endpoint_id, unit_id) DO UPDATE SET
			dataset_id = EXCLUDED.dataset_id,
			enabled = EXCLUDED.enabled,
			run_mode = EXCLUDED.run_mode,
			mode = EXCLUDED.mode,
			sink_id = EXCLUDED.sink_id,
			sink_endpoint_id = EXCLUDED.sink_endpoint_id,
			schedule_kind = EXCLUDED.schedule_kind,
			schedule_interval_minutes = EXCLUDED.schedule_interval_minutes,
			policy = EXCLUDED.policy,
			filter = EXCLUDED.filter,
			updated_at = NOW()
		RETURNING id, endpoint_id, dataset_id, unit_id, enabled, run_mode, mode, sink_id,
		          sink_endpoint_id, schedule_kind, schedule_interval_minutes, policy, filter,
		          created_at, updated_at
	`,
		config.ID, config.EndpointID, config.DatasetID, config.UnitID, config.Enabled,
		config.RunMode, config.Mode, config.SinkID, config.SinkEndpointID,
		config.ScheduleKind, config.ScheduleIntervalMinutes, config.Policy, config.Filter,
	).Scan(
		&result.ID, &result.EndpointID, &result.DatasetID, &result.UnitID, &result.Enabled,
		&result.RunMode, &result.Mode, &result.SinkID, &result.SinkEndpointID,
		&result.ScheduleKind, &result.ScheduleIntervalMinutes, &result.Policy, &result.Filter,
		&result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert ingestion config: %w", err)
	}
	return &result, nil
}

// =============================================================================
// INGESTION UNIT STATE QUERIES
// =============================================================================

// GetIngestionUnitState retrieves an ingestion unit state.
func (c *Client) GetIngestionUnitState(ctx context.Context, endpointID, unitID, sinkID string) (*IngestionUnitState, error) {
	var state IngestionUnitState
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, unit_id, sink_id, state, last_run_id, last_run_at,
		       last_error, stats, checkpoint, created_at, updated_at
		FROM ingestion_unit_states
		WHERE endpoint_id = $1 AND unit_id = $2 AND sink_id = $3
	`, endpointID, unitID, sinkID).Scan(
		&state.ID, &state.EndpointID, &state.UnitID, &state.SinkID, &state.State,
		&state.LastRunID, &state.LastRunAt, &state.LastError, &state.Stats, &state.Checkpoint,
		&state.CreatedAt, &state.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get ingestion state: %w", err)
	}
	return &state, nil
}

// UpsertIngestionUnitState creates or updates an ingestion unit state.
func (c *Client) UpsertIngestionUnitState(ctx context.Context, state *IngestionUnitState) error {
	if state.ID == "" {
		state.ID = uuid.New().String()
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO ingestion_unit_states (
			id, endpoint_id, unit_id, sink_id, state, last_run_id, last_run_at,
			last_error, stats, checkpoint
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (endpoint_id, unit_id, sink_id) DO UPDATE SET
			state = EXCLUDED.state,
			last_run_id = EXCLUDED.last_run_id,
			last_run_at = EXCLUDED.last_run_at,
			last_error = EXCLUDED.last_error,
			stats = COALESCE(EXCLUDED.stats, ingestion_unit_states.stats),
			checkpoint = COALESCE(EXCLUDED.checkpoint, ingestion_unit_states.checkpoint),
			updated_at = NOW()
	`,
		state.ID, state.EndpointID, state.UnitID, state.SinkID, state.State,
		state.LastRunID, state.LastRunAt, state.LastError, state.Stats, state.Checkpoint,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert ingestion state: %w", err)
	}
	return nil
}

// =============================================================================
// CHECKPOINT QUERIES
// =============================================================================

// GetIngestionCheckpoint retrieves an ingestion checkpoint.
func (c *Client) GetIngestionCheckpoint(ctx context.Context, endpointID, unitID, sinkID, vendor string) (map[string]interface{}, string, error) {
	var data json.RawMessage
	var version int

	err := c.db.QueryRowContext(ctx, `
		SELECT data, version
		FROM ingestion_checkpoints
		WHERE endpoint_id = $1 AND unit_id = $2 AND sink_id = $3 AND vendor = $4
	`, endpointID, unitID, sinkID, vendor).Scan(&data, &version)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("failed to get checkpoint: %w", err)
	}

	var checkpoint map[string]interface{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &checkpoint)
	}

	return checkpoint, strconv.Itoa(version), nil
}

// SaveIngestionCheckpoint saves an ingestion checkpoint with optimistic locking.
func (c *Client) SaveIngestionCheckpoint(ctx context.Context, endpointID, unitID, sinkID, vendor string, data json.RawMessage, expectedVersion string) error {
	id := uuid.New().String()

	if expectedVersion == "" {
		// Insert new checkpoint
		_, err := c.db.ExecContext(ctx, `
			INSERT INTO ingestion_checkpoints (id, endpoint_id, unit_id, sink_id, vendor, data, version)
			VALUES ($1, $2, $3, $4, $5, $6, 1)
			ON CONFLICT (endpoint_id, unit_id, sink_id, vendor) DO UPDATE SET
				data = EXCLUDED.data,
				version = ingestion_checkpoints.version + 1,
				updated_at = NOW()
		`, id, endpointID, unitID, sinkID, vendor, data)
		return err
	}

	// Update with version check
	version, _ := strconv.Atoi(expectedVersion)
	result, err := c.db.ExecContext(ctx, `
		UPDATE ingestion_checkpoints
		SET data = $1, version = version + 1, updated_at = NOW()
		WHERE endpoint_id = $2 AND unit_id = $3 AND sink_id = $4 AND vendor = $5 AND version = $6
	`, data, endpointID, unitID, sinkID, vendor, version)
	if err != nil {
		return err
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("checkpoint version conflict")
	}
	return nil
}

// =============================================================================
// TRANSIENT STATE QUERIES
// =============================================================================

// GetTransientState retrieves transient state for an ingestion unit.
func (c *Client) GetTransientState(ctx context.Context, endpointID, unitID, sinkID string) (map[string]interface{}, string, error) {
	var state json.RawMessage
	var version int

	err := c.db.QueryRowContext(ctx, `
		SELECT state, version
		FROM ingestion_transient_states
		WHERE endpoint_id = $1 AND unit_id = $2 AND sink_id = $3
	`, endpointID, unitID, sinkID).Scan(&state, &version)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("failed to get transient state: %w", err)
	}

	var transientState map[string]interface{}
	if len(state) > 0 {
		_ = json.Unmarshal(state, &transientState)
	}

	return transientState, strconv.Itoa(version), nil
}

// SaveTransientState saves transient state with optimistic locking.
func (c *Client) SaveTransientState(ctx context.Context, endpointID, unitID, sinkID string, state json.RawMessage, expectedVersion string) error {
	id := uuid.New().String()

	if expectedVersion == "" {
		_, err := c.db.ExecContext(ctx, `
			INSERT INTO ingestion_transient_states (id, endpoint_id, unit_id, sink_id, state, version)
			VALUES ($1, $2, $3, $4, $5, 1)
			ON CONFLICT (endpoint_id, unit_id, sink_id) DO UPDATE SET
				state = EXCLUDED.state,
				version = ingestion_transient_states.version + 1,
				updated_at = NOW()
		`, id, endpointID, unitID, sinkID, state)
		return err
	}

	version, _ := strconv.Atoi(expectedVersion)
	result, err := c.db.ExecContext(ctx, `
		UPDATE ingestion_transient_states
		SET state = $1, version = version + 1, updated_at = NOW()
		WHERE endpoint_id = $2 AND unit_id = $3 AND sink_id = $4 AND version = $5
	`, state, endpointID, unitID, sinkID, version)
	if err != nil {
		return err
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("transient state version conflict")
	}
	return nil
}

// =============================================================================
// COLLECTION QUERIES
// =============================================================================

// GetCollection retrieves a collection by ID.
func (c *Client) GetCollection(ctx context.Context, id string) (*MetadataCollection, error) {
	var col MetadataCollection
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, schedule_cron, schedule_timezone, is_enabled,
		       temporal_schedule_id, created_at, updated_at
		FROM metadata_collections
		WHERE id = $1
	`, id).Scan(
		&col.ID, &col.EndpointID, &col.ScheduleCron, &col.ScheduleTimezone,
		&col.IsEnabled, &col.TemporalScheduleID, &col.CreatedAt, &col.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get collection: %w", err)
	}
	return &col, nil
}

// ListCollections retrieves collections with optional filtering.
func (c *Client) ListCollections(ctx context.Context, endpointID *string, isEnabled *bool, limit int) ([]*MetadataCollection, error) {
	query := `
		SELECT id, endpoint_id, schedule_cron, schedule_timezone, is_enabled,
		       temporal_schedule_id, created_at, updated_at
		FROM metadata_collections
		WHERE 1=1
	`
	args := []interface{}{}
	argIdx := 1

	if endpointID != nil {
		query += fmt.Sprintf(" AND endpoint_id = $%d", argIdx)
		args = append(args, *endpointID)
		argIdx++
	}

	if isEnabled != nil {
		query += fmt.Sprintf(" AND is_enabled = $%d", argIdx)
		args = append(args, *isEnabled)
		argIdx++
	}

	if limit <= 0 {
		limit = 50
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d", limit)

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list collections: %w", err)
	}
	defer rows.Close()

	var collections []*MetadataCollection
	for rows.Next() {
		var col MetadataCollection
		if err := rows.Scan(
			&col.ID, &col.EndpointID, &col.ScheduleCron, &col.ScheduleTimezone,
			&col.IsEnabled, &col.TemporalScheduleID, &col.CreatedAt, &col.UpdatedAt,
		); err != nil {
			return nil, err
		}
		collections = append(collections, &col)
	}
	return collections, rows.Err()
}

// CreateCollection creates a new collection.
func (c *Client) CreateCollection(ctx context.Context, col *MetadataCollection) (*MetadataCollection, error) {
	if col.ID == "" {
		col.ID = uuid.New().String()
	}
	if col.ScheduleTimezone == "" {
		col.ScheduleTimezone = "UTC"
	}

	var result MetadataCollection
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO metadata_collections (id, endpoint_id, schedule_cron, schedule_timezone, is_enabled)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, endpoint_id, schedule_cron, schedule_timezone, is_enabled,
		          temporal_schedule_id, created_at, updated_at
	`, col.ID, col.EndpointID, col.ScheduleCron, col.ScheduleTimezone, col.IsEnabled).Scan(
		&result.ID, &result.EndpointID, &result.ScheduleCron, &result.ScheduleTimezone,
		&result.IsEnabled, &result.TemporalScheduleID, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create collection: %w", err)
	}
	return &result, nil
}

// UpdateCollection updates a collection.
func (c *Client) UpdateCollection(ctx context.Context, id string, updates map[string]interface{}) (*MetadataCollection, error) {
	// Build dynamic update
	setClauses := []string{}
	args := []interface{}{id}
	argIdx := 2

	for key, value := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", key, argIdx))
		args = append(args, value)
		argIdx++
	}

	if len(setClauses) == 0 {
		return c.GetCollection(ctx, id)
	}

	query := fmt.Sprintf(`
		UPDATE metadata_collections
		SET %s, updated_at = NOW()
		WHERE id = $1
		RETURNING id, endpoint_id, schedule_cron, schedule_timezone, is_enabled,
		          temporal_schedule_id, created_at, updated_at
	`, joinStrings(setClauses, ", "))

	var result MetadataCollection
	err := c.db.QueryRowContext(ctx, query, args...).Scan(
		&result.ID, &result.EndpointID, &result.ScheduleCron, &result.ScheduleTimezone,
		&result.IsEnabled, &result.TemporalScheduleID, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update collection: %w", err)
	}
	return &result, nil
}

// DeleteCollection deletes a collection.
func (c *Client) DeleteCollection(ctx context.Context, id string) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM metadata_collections WHERE id = $1`, id)
	return err
}

func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for _, s := range strs[1:] {
		result += sep + s
	}
	return result
}
