// Package database provides additional queries for endpoint templates and ingestion.
package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/lib/pq"
)

// NullableInt32 is an alias for sql.NullInt32.
type NullableInt32 = sql.NullInt32

// =============================================================================
// ENDPOINT TEMPLATE QUERIES
// =============================================================================

// ListEndpointTemplates retrieves all endpoint templates.
func (c *Client) ListEndpointTemplates(ctx context.Context) ([]*EndpointTemplate, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT id, family, title, vendor, description, domain, categories, protocols,
		       versions, default_port, driver, docs_url, agent_prompt, default_labels,
		       fields, capabilities, sample_config, connection, descriptor_version,
		       min_version, max_version, probing, extras, created_at, updated_at
		FROM endpoint_templates
		ORDER BY vendor, title
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}
	defer rows.Close()

	var templates []*EndpointTemplate
	for rows.Next() {
		var t EndpointTemplate
		err := rows.Scan(
			&t.ID, &t.Family, &t.Title, &t.Vendor, &t.Description, &t.Domain,
			pq.Array(&t.Categories), pq.Array(&t.Protocols), pq.Array(&t.Versions),
			&t.DefaultPort, &t.Driver, &t.DocsURL, &t.AgentPrompt, pq.Array(&t.DefaultLabels),
			&t.Fields, &t.Capabilities, &t.SampleConfig, &t.Connection, &t.DescriptorVersion,
			&t.MinVersion, &t.MaxVersion, &t.Probing, &t.Extras, &t.CreatedAt, &t.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan template: %w", err)
		}
		templates = append(templates, &t)
	}
	return templates, rows.Err()
}

// GetEndpointTemplate retrieves a template by ID.
func (c *Client) GetEndpointTemplate(ctx context.Context, id string) (*EndpointTemplate, error) {
	var t EndpointTemplate
	err := c.db.QueryRowContext(ctx, `
		SELECT id, family, title, vendor, description, domain, categories, protocols,
		       versions, default_port, driver, docs_url, agent_prompt, default_labels,
		       fields, capabilities, sample_config, connection, descriptor_version,
		       min_version, max_version, probing, extras, created_at, updated_at
		FROM endpoint_templates
		WHERE id = $1
	`, id).Scan(
		&t.ID, &t.Family, &t.Title, &t.Vendor, &t.Description, &t.Domain,
		pq.Array(&t.Categories), pq.Array(&t.Protocols), pq.Array(&t.Versions),
		&t.DefaultPort, &t.Driver, &t.DocsURL, &t.AgentPrompt, pq.Array(&t.DefaultLabels),
		&t.Fields, &t.Capabilities, &t.SampleConfig, &t.Connection, &t.DescriptorVersion,
		&t.MinVersion, &t.MaxVersion, &t.Probing, &t.Extras, &t.CreatedAt, &t.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get template: %w", err)
	}
	return &t, nil
}

// SaveEndpointTemplates upserts endpoint templates.
func (c *Client) SaveEndpointTemplates(ctx context.Context, templates []*EndpointTemplate) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, t := range templates {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO endpoint_templates (
				id, family, title, vendor, description, domain, categories, protocols,
				versions, default_port, driver, docs_url, agent_prompt, default_labels,
				fields, capabilities, sample_config, connection, descriptor_version,
				min_version, max_version, probing, extras
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			ON CONFLICT (id) DO UPDATE SET
				family = EXCLUDED.family,
				title = EXCLUDED.title,
				vendor = EXCLUDED.vendor,
				description = EXCLUDED.description,
				domain = EXCLUDED.domain,
				categories = EXCLUDED.categories,
				protocols = EXCLUDED.protocols,
				versions = EXCLUDED.versions,
				default_port = EXCLUDED.default_port,
				driver = EXCLUDED.driver,
				docs_url = EXCLUDED.docs_url,
				agent_prompt = EXCLUDED.agent_prompt,
				default_labels = EXCLUDED.default_labels,
				fields = EXCLUDED.fields,
				capabilities = EXCLUDED.capabilities,
				sample_config = EXCLUDED.sample_config,
				connection = EXCLUDED.connection,
				descriptor_version = EXCLUDED.descriptor_version,
				min_version = EXCLUDED.min_version,
				max_version = EXCLUDED.max_version,
				probing = EXCLUDED.probing,
				extras = EXCLUDED.extras,
				updated_at = NOW()
		`,
			t.ID, t.Family, t.Title, t.Vendor, t.Description, t.Domain,
			pq.Array(t.Categories), pq.Array(t.Protocols), pq.Array(t.Versions),
			t.DefaultPort, t.Driver, t.DocsURL, t.AgentPrompt, pq.Array(t.DefaultLabels),
			t.Fields, t.Capabilities, t.SampleConfig, t.Connection, t.DescriptorVersion,
			t.MinVersion, t.MaxVersion, t.Probing, t.Extras,
		)
		if err != nil {
			return fmt.Errorf("failed to save template %s: %w", t.ID, err)
		}
	}

	return tx.Commit()
}

// =============================================================================
// INGESTION UNIT STATE QUERIES (extended)
// =============================================================================

// ListIngestionUnitStates returns all ingestion states for an endpoint.
func (c *Client) ListIngestionUnitStates(ctx context.Context, endpointID string) ([]*IngestionUnitState, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT id, endpoint_id, unit_id, sink_id, state, last_run_id, last_run_at,
		       last_error, stats, checkpoint, created_at, updated_at
		FROM ingestion_unit_states
		WHERE endpoint_id = $1
		ORDER BY unit_id
	`, endpointID)
	if err != nil {
		return nil, fmt.Errorf("failed to list ingestion states: %w", err)
	}
	defer rows.Close()

	var states []*IngestionUnitState
	for rows.Next() {
		var s IngestionUnitState
		err := rows.Scan(
			&s.ID, &s.EndpointID, &s.UnitID, &s.SinkID, &s.State,
			&s.LastRunID, &s.LastRunAt, &s.LastError, &s.Stats, &s.Checkpoint,
			&s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		states = append(states, &s)
	}
	return states, rows.Err()
}

// ListIngestionUnitConfigs returns all ingestion configs for an endpoint.
func (c *Client) ListIngestionUnitConfigs(ctx context.Context, endpointID string) ([]*IngestionUnitConfig, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT id, endpoint_id, dataset_id, unit_id, enabled, run_mode, mode, sink_id,
		       sink_endpoint_id, schedule_kind, schedule_interval_minutes, policy, filter,
		       created_at, updated_at
		FROM ingestion_unit_configs
		WHERE endpoint_id = $1
		ORDER BY unit_id
	`, endpointID)
	if err != nil {
		return nil, fmt.Errorf("failed to list ingestion configs: %w", err)
	}
	defer rows.Close()

	var configs []*IngestionUnitConfig
	for rows.Next() {
		var c IngestionUnitConfig
		err := rows.Scan(
			&c.ID, &c.EndpointID, &c.DatasetID, &c.UnitID, &c.Enabled,
			&c.RunMode, &c.Mode, &c.SinkID, &c.SinkEndpointID,
			&c.ScheduleKind, &c.ScheduleIntervalMinutes, &c.Policy, &c.Filter,
			&c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		configs = append(configs, &c)
	}
	return configs, rows.Err()
}

// =============================================================================
// GRAPH NODE QUERIES
// =============================================================================

// ListGraphNodes retrieves graph nodes with filtering.
func (c *Client) ListGraphNodes(ctx context.Context, tenantID string, entityTypes []string, search *string, limit int) ([]*GraphNode, error) {
	query := `
		SELECT id, tenant_id, project_id, entity_type, display_name, canonical_path,
		       source_system, spec_ref, properties, version, phase, logical_key,
		       external_id, provenance, created_at, updated_at
		FROM graph_nodes
		WHERE tenant_id = $1
	`
	args := []interface{}{tenantID}
	argIdx := 2

	if len(entityTypes) > 0 {
		query += fmt.Sprintf(" AND entity_type = ANY($%d)", argIdx)
		args = append(args, pq.Array(entityTypes))
		argIdx++
	}

	if search != nil && *search != "" {
		query += fmt.Sprintf(" AND (display_name ILIKE $%d OR canonical_path ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+*search+"%")
		argIdx++
	}

	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(" ORDER BY updated_at DESC LIMIT %d", limit)

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list graph nodes: %w", err)
	}
	defer rows.Close()

	var nodes []*GraphNode
	for rows.Next() {
		var n GraphNode
		err := rows.Scan(
			&n.ID, &n.TenantID, &n.ProjectID, &n.EntityType, &n.DisplayName, &n.CanonicalPath,
			&n.SourceSystem, &n.SpecRef, &n.Properties, &n.Version, &n.Phase, &n.LogicalKey,
			&n.ExternalID, &n.Provenance, &n.CreatedAt, &n.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, &n)
	}
	return nodes, rows.Err()
}

// GetGraphNode retrieves a single graph node.
func (c *Client) GetGraphNode(ctx context.Context, id string) (*GraphNode, error) {
	var n GraphNode
	err := c.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, project_id, entity_type, display_name, canonical_path,
		       source_system, spec_ref, properties, version, phase, logical_key,
		       external_id, provenance, created_at, updated_at
		FROM graph_nodes
		WHERE id = $1
	`, id).Scan(
		&n.ID, &n.TenantID, &n.ProjectID, &n.EntityType, &n.DisplayName, &n.CanonicalPath,
		&n.SourceSystem, &n.SpecRef, &n.Properties, &n.Version, &n.Phase, &n.LogicalKey,
		&n.ExternalID, &n.Provenance, &n.CreatedAt, &n.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get graph node: %w", err)
	}
	return &n, nil
}

// UpsertGraphNode creates or updates a graph node.
func (c *Client) UpsertGraphNode(ctx context.Context, node *GraphNode) (*GraphNode, error) {
	var result GraphNode
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO graph_nodes (
			id, tenant_id, project_id, entity_type, display_name, canonical_path,
			source_system, spec_ref, properties, version, phase, logical_key,
			external_id, provenance
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (tenant_id, logical_key) DO UPDATE SET
			project_id = EXCLUDED.project_id,
			entity_type = EXCLUDED.entity_type,
			display_name = EXCLUDED.display_name,
			canonical_path = EXCLUDED.canonical_path,
			source_system = EXCLUDED.source_system,
			spec_ref = EXCLUDED.spec_ref,
			properties = EXCLUDED.properties,
			version = graph_nodes.version + 1,
			phase = EXCLUDED.phase,
			external_id = EXCLUDED.external_id,
			provenance = EXCLUDED.provenance,
			updated_at = NOW()
		RETURNING id, tenant_id, project_id, entity_type, display_name, canonical_path,
		          source_system, spec_ref, properties, version, phase, logical_key,
		          external_id, provenance, created_at, updated_at
	`,
		node.ID, node.TenantID, node.ProjectID, node.EntityType, node.DisplayName, node.CanonicalPath,
		node.SourceSystem, node.SpecRef, node.Properties, node.Version, node.Phase, node.LogicalKey,
		node.ExternalID, node.Provenance,
	).Scan(
		&result.ID, &result.TenantID, &result.ProjectID, &result.EntityType, &result.DisplayName, &result.CanonicalPath,
		&result.SourceSystem, &result.SpecRef, &result.Properties, &result.Version, &result.Phase, &result.LogicalKey,
		&result.ExternalID, &result.Provenance, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert graph node: %w", err)
	}
	return &result, nil
}

// =============================================================================
// GRAPH EDGE QUERIES
// =============================================================================

// ListGraphEdges retrieves graph edges with filtering.
func (c *Client) ListGraphEdges(ctx context.Context, tenantID string, edgeTypes []string, sourceID *string, targetID *string, limit int) ([]*GraphEdge, error) {
	query := `
		SELECT id, tenant_id, project_id, edge_type, source_entity_id, target_entity_id,
		       confidence, spec_ref, metadata, logical_key, source_logical_key,
		       target_logical_key, provenance, created_at, updated_at
		FROM graph_edges
		WHERE tenant_id = $1
	`
	args := []interface{}{tenantID}
	argIdx := 2

	if len(edgeTypes) > 0 {
		query += fmt.Sprintf(" AND edge_type = ANY($%d)", argIdx)
		args = append(args, pq.Array(edgeTypes))
		argIdx++
	}

	if sourceID != nil {
		query += fmt.Sprintf(" AND source_entity_id = $%d", argIdx)
		args = append(args, *sourceID)
		argIdx++
	}

	if targetID != nil {
		query += fmt.Sprintf(" AND target_entity_id = $%d", argIdx)
		args = append(args, *targetID)
		argIdx++
	}

	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d", limit)

	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list graph edges: %w", err)
	}
	defer rows.Close()

	var edges []*GraphEdge
	for rows.Next() {
		var e GraphEdge
		err := rows.Scan(
			&e.ID, &e.TenantID, &e.ProjectID, &e.EdgeType, &e.SourceEntityID, &e.TargetEntityID,
			&e.Confidence, &e.SpecRef, &e.Metadata, &e.LogicalKey, &e.SourceLogical,
			&e.TargetLogical, &e.Provenance, &e.CreatedAt, &e.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		edges = append(edges, &e)
	}
	return edges, rows.Err()
}

// UpsertGraphEdge creates or updates a graph edge.
func (c *Client) UpsertGraphEdge(ctx context.Context, edge *GraphEdge) (*GraphEdge, error) {
	provenanceBytes, _ := json.Marshal(edge.Provenance)

	var result GraphEdge
	err := c.db.QueryRowContext(ctx, `
		INSERT INTO graph_edges (
			id, tenant_id, project_id, edge_type, source_entity_id, target_entity_id,
			confidence, spec_ref, metadata, logical_key, source_logical_key,
			target_logical_key, provenance
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (tenant_id, logical_key) DO UPDATE SET
			project_id = EXCLUDED.project_id,
			edge_type = EXCLUDED.edge_type,
			source_entity_id = EXCLUDED.source_entity_id,
			target_entity_id = EXCLUDED.target_entity_id,
			confidence = EXCLUDED.confidence,
			spec_ref = EXCLUDED.spec_ref,
			metadata = EXCLUDED.metadata,
			source_logical_key = EXCLUDED.source_logical_key,
			target_logical_key = EXCLUDED.target_logical_key,
			provenance = EXCLUDED.provenance,
			updated_at = NOW()
		RETURNING id, tenant_id, project_id, edge_type, source_entity_id, target_entity_id,
		          confidence, spec_ref, metadata, logical_key, source_logical_key,
		          target_logical_key, provenance, created_at, updated_at
	`,
		edge.ID, edge.TenantID, edge.ProjectID, edge.EdgeType, edge.SourceEntityID, edge.TargetEntityID,
		edge.Confidence, edge.SpecRef, edge.Metadata, edge.LogicalKey, edge.SourceLogical,
		edge.TargetLogical, provenanceBytes,
	).Scan(
		&result.ID, &result.TenantID, &result.ProjectID, &result.EdgeType, &result.SourceEntityID, &result.TargetEntityID,
		&result.Confidence, &result.SpecRef, &result.Metadata, &result.LogicalKey, &result.SourceLogical,
		&result.TargetLogical, &result.Provenance, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert graph edge: %w", err)
	}
	return &result, nil
}
