// Package database provides queries for metadata-api database operations.
package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// =============================================================================
// PROJECT QUERIES
// =============================================================================

// GetProject retrieves a project by ID or slug.
func (c *Client) GetProject(ctx context.Context, idOrSlug string) (*MetadataProject, error) {
	row := c.db.QueryRowContext(ctx, `
		SELECT id, slug, display_name, created_at, updated_at
		FROM metadata_projects
		WHERE id = $1 OR slug = $1
	`, idOrSlug)

	var p MetadataProject
	err := row.Scan(&p.ID, &p.Slug, &p.DisplayName, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get project: %w", err)
	}
	return &p, nil
}

// GetOrCreateProject gets or creates a project by ID.
func (c *Client) GetOrCreateProject(ctx context.Context, id string) (*MetadataProject, error) {
	existing, err := c.GetProject(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	slug := slugifyProjectID(id)
	displayName := id
	if id == "global" {
		displayName = "Global Metadata"
	}

	var p MetadataProject
	err = c.db.QueryRowContext(ctx, `
		INSERT INTO metadata_projects (id, slug, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
		RETURNING id, slug, display_name, created_at, updated_at
	`, id, slug, displayName).Scan(&p.ID, &p.Slug, &p.DisplayName, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}
	return &p, nil
}

func slugifyProjectID(input string) string {
	normalized := strings.TrimSpace(strings.ToLower(input))
	slug := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, normalized)
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "project"
	}
	return slug
}

// =============================================================================
// ENDPOINT QUERIES
// =============================================================================

// GetEndpoint retrieves an endpoint by ID.
func (c *Client) GetEndpoint(ctx context.Context, id string) (*MetadataEndpoint, error) {
	row := c.db.QueryRowContext(ctx, `
		SELECT id, source_id, project_id, name, description, verb, url, auth_policy,
		       domain, labels, config, detected_version, version_hint, capabilities,
		       delegated_connected, created_at, updated_at, deleted_at, deletion_reason
		FROM metadata_endpoints
		WHERE id = $1
	`, id)

	return scanEndpoint(row)
}

// GetEndpointBySourceID retrieves an endpoint by source ID.
func (c *Client) GetEndpointBySourceID(ctx context.Context, sourceID string) (*MetadataEndpoint, error) {
	row := c.db.QueryRowContext(ctx, `
		SELECT id, source_id, project_id, name, description, verb, url, auth_policy,
		       domain, labels, config, detected_version, version_hint, capabilities,
		       delegated_connected, created_at, updated_at, deleted_at, deletion_reason
		FROM metadata_endpoints
		WHERE source_id = $1 AND deleted_at IS NULL
	`, sourceID)

	return scanEndpoint(row)
}

// ListEndpoints retrieves endpoints, optionally filtered by project.
func (c *Client) ListEndpoints(ctx context.Context, projectID *string, includeDeleted bool) ([]*MetadataEndpoint, error) {
	query := `
		SELECT id, source_id, project_id, name, description, verb, url, auth_policy,
		       domain, labels, config, detected_version, version_hint, capabilities,
		       delegated_connected, created_at, updated_at, deleted_at, deletion_reason
		FROM metadata_endpoints
		WHERE 1=1
	`
	args := []any{}
	argIdx := 1

	if projectID != nil {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, *projectID)
		argIdx++
	}

	if !includeDeleted {
		query += " AND deleted_at IS NULL"
	}

	query += " ORDER BY created_at DESC"

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list endpoints: %w", err)
	}
	defer rows.Close()

	var endpoints []*MetadataEndpoint
	for rows.Next() {
		ep, err := scanEndpointRow(rows)
		if err != nil {
			return nil, err
		}
		endpoints = append(endpoints, ep)
	}
	return endpoints, rows.Err()
}

// UpsertEndpoint creates or updates an endpoint.
func (c *Client) UpsertEndpoint(ctx context.Context, ep *MetadataEndpoint) (*MetadataEndpoint, error) {
	if ep.ID == "" {
		ep.ID = uuid.New().String()
	}

	configBytes, _ := json.Marshal(ep.Config)

	var result MetadataEndpoint
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO metadata_endpoints (
			id, source_id, project_id, name, description, verb, url, auth_policy,
			domain, labels, config, detected_version, version_hint, capabilities,
			delegated_connected
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (id) DO UPDATE SET
			source_id = EXCLUDED.source_id,
			project_id = EXCLUDED.project_id,
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			verb = EXCLUDED.verb,
			url = EXCLUDED.url,
			auth_policy = EXCLUDED.auth_policy,
			domain = EXCLUDED.domain,
			labels = EXCLUDED.labels,
			config = EXCLUDED.config,
			detected_version = EXCLUDED.detected_version,
			version_hint = EXCLUDED.version_hint,
			capabilities = EXCLUDED.capabilities,
			delegated_connected = EXCLUDED.delegated_connected,
			updated_at = NOW()
		RETURNING id, source_id, project_id, name, description, verb, url, auth_policy,
		          domain, labels, config, detected_version, version_hint, capabilities,
		          delegated_connected, created_at, updated_at, deleted_at, deletion_reason
	`,
		ep.ID, ep.SourceID, ep.ProjectID, ep.Name, ep.Description, ep.Verb, ep.URL, ep.AuthPolicy,
		ep.Domain, pq.Array(ep.Labels), configBytes, ep.DetectedVersion, ep.VersionHint, pq.Array(ep.Capabilities),
		ep.DelegatedConnected,
	).Scan(
		&result.ID, &result.SourceID, &result.ProjectID, &result.Name, &result.Description,
		&result.Verb, &result.URL, &result.AuthPolicy, &result.Domain,
		pq.Array(&result.Labels), &result.Config, &result.DetectedVersion, &result.VersionHint,
		pq.Array(&result.Capabilities), &result.DelegatedConnected,
		&result.CreatedAt, &result.UpdatedAt, &result.DeletedAt, &result.DeletionReason,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert endpoint: %w", err)
	}
	return &result, nil
}

// SoftDeleteEndpoint marks an endpoint as deleted.
func (c *Client) SoftDeleteEndpoint(ctx context.Context, id string, reason *string) error {
	_, err := c.db.ExecContext(ctx, `
		UPDATE metadata_endpoints
		SET deleted_at = NOW(), deletion_reason = $2, updated_at = NOW()
		WHERE id = $1
	`, id, reason)
	return err
}

// =============================================================================
// COLLECTION RUN QUERIES
// =============================================================================

// CreateCollectionRun creates a new collection run.
func (c *Client) CreateCollectionRun(ctx context.Context, endpointID string, collectionID *string, requestedBy *string) (*MetadataCollectionRun, error) {
	id := uuid.New().String()

	var run MetadataCollectionRun
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO metadata_collection_runs (id, endpoint_id, collection_id, status, requested_by)
		VALUES ($1, $2, $3, 'QUEUED', $4)
		RETURNING id, endpoint_id, collection_id, status, requested_by, requested_at,
		          started_at, completed_at, workflow_id, temporal_run_id, error, filters
	`, id, endpointID, collectionID, requestedBy).Scan(
		&run.ID, &run.EndpointID, &run.CollectionID, &run.Status, &run.RequestedBy, &run.RequestedAt,
		&run.StartedAt, &run.CompletedAt, &run.WorkflowID, &run.TemporalRunID, &run.Error, &run.Filters,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create collection run: %w", err)
	}
	return &run, nil
}

// UpdateCollectionRunStatus updates a collection run's status.
func (c *Client) UpdateCollectionRunStatus(ctx context.Context, runID string, status MetadataCollectionRunStatus, updates map[string]any) error {
	setClauses := []string{"status = $2"}
	args := []any{runID, status}
	argIdx := 3

	for key, value := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", key, argIdx))
		args = append(args, value)
		argIdx++
	}

	query := fmt.Sprintf(`
		UPDATE metadata_collection_runs
		SET %s
		WHERE id = $1
	`, strings.Join(setClauses, ", "))

	result, err := c.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update collection run: %w", err)
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("collection run %s not found", runID)
	}
	return nil
}

// MarkRunStarted updates a run to RUNNING status.
func (c *Client) MarkRunStarted(ctx context.Context, runID, workflowID, temporalRunID string) error {
	return c.UpdateCollectionRunStatus(ctx, runID, CollectionStatusRunning, map[string]any{
		"started_at":      time.Now(),
		"workflow_id":     workflowID,
		"temporal_run_id": temporalRunID,
		"error":           nil,
	})
}

// MarkRunCompleted updates a run to SUCCEEDED status.
func (c *Client) MarkRunCompleted(ctx context.Context, runID string) error {
	return c.UpdateCollectionRunStatus(ctx, runID, CollectionStatusSucceeded, map[string]any{
		"completed_at": time.Now(),
		"error":        nil,
	})
}

// MarkRunFailed updates a run to FAILED status.
func (c *Client) MarkRunFailed(ctx context.Context, runID, errMsg string) error {
	return c.UpdateCollectionRunStatus(ctx, runID, CollectionStatusFailed, map[string]any{
		"completed_at": time.Now(),
		"error":        errMsg,
	})
}

// MarkRunSkipped updates a run to SKIPPED status.
func (c *Client) MarkRunSkipped(ctx context.Context, runID, reason string) error {
	return c.UpdateCollectionRunStatus(ctx, runID, CollectionStatusSkipped, map[string]any{
		"completed_at": time.Now(),
		"error":        reason,
	})
}

// =============================================================================
// METADATA RECORD QUERIES
// =============================================================================

// UpsertRecord creates or updates a metadata record.
func (c *Client) UpsertRecord(ctx context.Context, record *MetadataRecord) (*MetadataRecord, error) {
	var result MetadataRecord
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO metadata_records (id, domain, project_id, labels, payload)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (domain, id) DO UPDATE SET
			project_id = EXCLUDED.project_id,
			labels = EXCLUDED.labels,
			payload = EXCLUDED.payload,
			updated_at = NOW()
		RETURNING id, domain, project_id, labels, payload, created_at, updated_at
	`, record.ID, record.Domain, record.ProjectID, pq.Array(record.Labels), record.Payload).Scan(
		&result.ID, &result.Domain, &result.ProjectID,
		pq.Array(&result.Labels), &result.Payload, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert record: %w", err)
	}
	return &result, nil
}

// GetRecord retrieves a record by domain and ID.
func (c *Client) GetRecord(ctx context.Context, domain, id string) (*MetadataRecord, error) {
	var r MetadataRecord
	err := c.db.QueryRowContext(ctx, `
		SELECT id, domain, project_id, labels, payload, created_at, updated_at
		FROM metadata_records
		WHERE domain = $1 AND id = $2
	`, domain, id).Scan(
		&r.ID, &r.Domain, &r.ProjectID, pq.Array(&r.Labels), &r.Payload, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get record: %w", err)
	}
	return &r, nil
}

// ListRecords retrieves records with filtering.
func (c *Client) ListRecords(ctx context.Context, domain string, projectID *string, labels []string, search *string, limit int) ([]*MetadataRecord, error) {
	query := `
		SELECT id, domain, project_id, labels, payload, created_at, updated_at
		FROM metadata_records
		WHERE domain = $1
	`
	args := []any{domain}
	argIdx := 2

	if projectID != nil {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, *projectID)
		argIdx++
	}

	if len(labels) > 0 {
		query += fmt.Sprintf(" AND labels @> $%d", argIdx)
		args = append(args, pq.Array(labels))
		argIdx++
	}

	if search != nil && *search != "" {
		query += fmt.Sprintf(" AND (id ILIKE $%d OR payload::text ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+*search+"%")
		argIdx++
	}

	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(" ORDER BY updated_at DESC LIMIT %d", limit)

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list records: %w", err)
	}
	defer rows.Close()

	var records []*MetadataRecord
	for rows.Next() {
		var r MetadataRecord
		if err := rows.Scan(&r.ID, &r.Domain, &r.ProjectID, pq.Array(&r.Labels), &r.Payload, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, &r)
	}
	return records, rows.Err()
}

// =============================================================================
// HELPERS
// =============================================================================

type rowScanner interface {
	Scan(dest ...any) error
}

func scanEndpoint(row rowScanner) (*MetadataEndpoint, error) {
	var ep MetadataEndpoint
	err := row.Scan(
		&ep.ID, &ep.SourceID, &ep.ProjectID, &ep.Name, &ep.Description,
		&ep.Verb, &ep.URL, &ep.AuthPolicy, &ep.Domain,
		pq.Array(&ep.Labels), &ep.Config, &ep.DetectedVersion, &ep.VersionHint,
		pq.Array(&ep.Capabilities), &ep.DelegatedConnected,
		&ep.CreatedAt, &ep.UpdatedAt, &ep.DeletedAt, &ep.DeletionReason,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan endpoint: %w", err)
	}
	return &ep, nil
}

func scanEndpointRow(rows *sql.Rows) (*MetadataEndpoint, error) {
	var ep MetadataEndpoint
	err := rows.Scan(
		&ep.ID, &ep.SourceID, &ep.ProjectID, &ep.Name, &ep.Description,
		&ep.Verb, &ep.URL, &ep.AuthPolicy, &ep.Domain,
		pq.Array(&ep.Labels), &ep.Config, &ep.DetectedVersion, &ep.VersionHint,
		pq.Array(&ep.Capabilities), &ep.DelegatedConnected,
		&ep.CreatedAt, &ep.UpdatedAt, &ep.DeletedAt, &ep.DeletionReason,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scan endpoint row: %w", err)
	}
	return &ep, nil
}
