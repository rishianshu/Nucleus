package entity

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	// P2 Fix: Use proper PostgreSQL array handling
)

// ===================================================
// PostgreSQL Entity Registry
// Persistent storage for canonical entities
// ===================================================

// PostgresEntityRegistry implements EntityRegistry using PostgreSQL.
type PostgresEntityRegistry struct {
	db *sql.DB
}

// NewPostgresEntityRegistry creates a new PostgreSQL-backed registry.
func NewPostgresEntityRegistry(db *sql.DB) (*PostgresEntityRegistry, error) {
	registry := &PostgresEntityRegistry{db: db}
	if err := registry.ensureSchema(); err != nil {
		return nil, fmt.Errorf("failed to ensure schema: %w", err)
	}
	return registry, nil
}

// ensureSchema creates the required tables if they don't exist.
func (r *PostgresEntityRegistry) ensureSchema() error {
	schema := `
	-- P1 Fix: Ensure pg_trgm extension exists for fuzzy search
	CREATE EXTENSION IF NOT EXISTS pg_trgm;

	-- Canonical entities table
	-- P0 Fix: Use TEXT for ID to accommodate existing generateCanonicalID format
	CREATE TABLE IF NOT EXISTS canonical_entities (
		id TEXT PRIMARY KEY,
		tenant_id TEXT NOT NULL,
		entity_type TEXT NOT NULL,
		name TEXT NOT NULL,
		aliases TEXT[] DEFAULT '{}',
		qualifiers JSONB DEFAULT '{}',
		properties JSONB DEFAULT '{}',
		merged_from TEXT[] DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	-- Source references table
	CREATE TABLE IF NOT EXISTS entity_source_refs (
		id SERIAL PRIMARY KEY,
		entity_id TEXT NOT NULL REFERENCES canonical_entities(id) ON DELETE CASCADE,
		source TEXT NOT NULL,
		external_id TEXT NOT NULL,
		node_id TEXT,
		url TEXT,
		last_synced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE(entity_id, source, external_id)
	);

	-- Indexes for efficient queries
	CREATE INDEX IF NOT EXISTS idx_entities_tenant ON canonical_entities(tenant_id);
	CREATE INDEX IF NOT EXISTS idx_entities_type ON canonical_entities(tenant_id, entity_type);
	CREATE INDEX IF NOT EXISTS idx_entities_name ON canonical_entities(tenant_id, name);
	CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON canonical_entities USING gin(name gin_trgm_ops);
	CREATE INDEX IF NOT EXISTS idx_source_refs_lookup ON entity_source_refs(source, external_id);
	CREATE INDEX IF NOT EXISTS idx_source_refs_entity ON entity_source_refs(entity_id);

	-- GIN index for alias search
	CREATE INDEX IF NOT EXISTS idx_entities_aliases ON canonical_entities USING gin(aliases);
	`

	_, err := r.db.Exec(schema)
	return err
}

// Create creates a new canonical entity.
func (r *PostgresEntityRegistry) Create(ctx context.Context, entity *CanonicalEntity) error {
	if entity.ID == "" {
		entity.ID = uuid.New().String()
	}
	if entity.CreatedAt.IsZero() {
		entity.CreatedAt = time.Now()
	}
	entity.UpdatedAt = time.Now()

	qualifiersJSON, err := json.Marshal(entity.Qualifiers)
	if err != nil {
		return fmt.Errorf("failed to marshal qualifiers: %w", err)
	}

	propertiesJSON, err := json.Marshal(entity.Properties)
	if err != nil {
		return fmt.Errorf("failed to marshal properties: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Insert entity
	_, err = tx.ExecContext(ctx, `
		INSERT INTO canonical_entities 
		(id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, entity.ID, entity.TenantID, entity.Type, entity.Name,
		pq.Array(entity.Aliases), qualifiersJSON, propertiesJSON,
		pq.Array(entity.MergedFrom), entity.CreatedAt, entity.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert entity: %w", err)
	}

	// Insert source refs
	for _, ref := range entity.SourceRefs {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO entity_source_refs (entity_id, source, external_id, node_id, url, last_synced)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (entity_id, source, external_id) DO UPDATE SET
				node_id = EXCLUDED.node_id,
				url = EXCLUDED.url,
				last_synced = EXCLUDED.last_synced
		`, entity.ID, ref.Source, ref.ExternalID, ref.NodeID, ref.URL, ref.LastSynced)
		if err != nil {
			return fmt.Errorf("failed to insert source ref: %w", err)
		}
	}

	return tx.Commit()
}

// Get retrieves an entity by canonical ID.
func (r *PostgresEntityRegistry) Get(ctx context.Context, tenantID, id string) (*CanonicalEntity, error) {
	entity := &CanonicalEntity{}
	var qualifiersJSON, propertiesJSON []byte
	var aliases, mergedFrom []string

	err := r.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from, created_at, updated_at
		FROM canonical_entities
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
		pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
		pq.Array(&mergedFrom), &entity.CreatedAt, &entity.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get entity: %w", err)
	}

	entity.Aliases = aliases
	entity.MergedFrom = mergedFrom

	if err := json.Unmarshal(qualifiersJSON, &entity.Qualifiers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal qualifiers: %w", err)
	}
	if err := json.Unmarshal(propertiesJSON, &entity.Properties); err != nil {
		return nil, fmt.Errorf("failed to unmarshal properties: %w", err)
	}

	// Get source refs
	entity.SourceRefs, err = r.getSourceRefs(ctx, id)
	if err != nil {
		return nil, err
	}

	return entity, nil
}

// GetBySourceRef retrieves by source reference.
func (r *PostgresEntityRegistry) GetBySourceRef(ctx context.Context, tenantID, source, externalID string) (*CanonicalEntity, error) {
	var entityID string
	err := r.db.QueryRowContext(ctx, `
		SELECT e.id 
		FROM canonical_entities e
		JOIN entity_source_refs sr ON e.id = sr.entity_id
		WHERE e.tenant_id = $1 AND sr.source = $2 AND sr.external_id = $3
	`, tenantID, source, externalID).Scan(&entityID)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to lookup by source ref: %w", err)
	}

	return r.Get(ctx, tenantID, entityID)
}

// Update updates an existing entity.
func (r *PostgresEntityRegistry) Update(ctx context.Context, entity *CanonicalEntity) error {
	entity.UpdatedAt = time.Now()

	qualifiersJSON, err := json.Marshal(entity.Qualifiers)
	if err != nil {
		return fmt.Errorf("failed to marshal qualifiers: %w", err)
	}

	propertiesJSON, err := json.Marshal(entity.Properties)
	if err != nil {
		return fmt.Errorf("failed to marshal properties: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE canonical_entities 
		SET entity_type = $1, name = $2, aliases = $3, qualifiers = $4, 
		    properties = $5, merged_from = $6, updated_at = $7
		WHERE id = $8 AND tenant_id = $9
	`, entity.Type, entity.Name, pq.Array(entity.Aliases), qualifiersJSON,
		propertiesJSON, pq.Array(entity.MergedFrom), entity.UpdatedAt,
		entity.ID, entity.TenantID)
	if err != nil {
		return fmt.Errorf("failed to update entity: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("entity not found: %s", entity.ID)
	}

	return tx.Commit()
}

// Delete removes an entity.
func (r *PostgresEntityRegistry) Delete(ctx context.Context, tenantID, id string) error {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM canonical_entities WHERE id = $1 AND tenant_id = $2
	`, id, tenantID)
	if err != nil {
		return fmt.Errorf("failed to delete entity: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("entity not found: %s", id)
	}

	return nil
}

// List lists entities with filters.
func (r *PostgresEntityRegistry) List(ctx context.Context, tenantID string, filter EntityFilter, limit, offset int) ([]*CanonicalEntity, error) {
	query := strings.Builder{}
	query.WriteString("SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from, created_at, updated_at FROM canonical_entities WHERE tenant_id = $1")
	args := []any{tenantID}
	argNum := 2

	// Apply filters
	if len(filter.Types) > 0 {
		// P1 Fix: Cast to text[] for proper PostgreSQL array binding
		query.WriteString(fmt.Sprintf(" AND entity_type = ANY($%d::text[])", argNum))
		args = append(args, pq.Array(filter.Types))
		argNum++
	}

	if filter.NameLike != "" {
		query.WriteString(fmt.Sprintf(" AND name ILIKE $%d", argNum))
		args = append(args, "%"+filter.NameLike+"%")
		argNum++
	}

	if filter.Source != "" {
		query.WriteString(fmt.Sprintf(" AND id IN (SELECT entity_id FROM entity_source_refs WHERE source = $%d)", argNum))
		args = append(args, filter.Source)
		argNum++
	}

	if !filter.UpdatedAfter.IsZero() {
		query.WriteString(fmt.Sprintf(" AND updated_at > $%d", argNum))
		args = append(args, filter.UpdatedAfter)
		argNum++
	}

	// Add ordering and pagination
	query.WriteString(" ORDER BY updated_at DESC")
	query.WriteString(fmt.Sprintf(" LIMIT $%d OFFSET $%d", argNum, argNum+1))
	args = append(args, limit, offset)

	rows, err := r.db.QueryContext(ctx, query.String(), args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list entities: %w", err)
	}
	defer rows.Close()

	var entities []*CanonicalEntity
	for rows.Next() {
		entity := &CanonicalEntity{}
		var qualifiersJSON, propertiesJSON []byte
		var aliases, mergedFrom []string

		err := rows.Scan(
			&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
			pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
			pq.Array(&mergedFrom), &entity.CreatedAt, &entity.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan entity: %w", err)
		}

		entity.Aliases = aliases
		entity.MergedFrom = mergedFrom
		
		// P3 Fix: Return errors instead of silently ignoring
		if err := json.Unmarshal(qualifiersJSON, &entity.Qualifiers); err != nil {
			return nil, fmt.Errorf("failed to unmarshal qualifiers for %s: %w", entity.ID, err)
		}
		if err := json.Unmarshal(propertiesJSON, &entity.Properties); err != nil {
			return nil, fmt.Errorf("failed to unmarshal properties for %s: %w", entity.ID, err)
		}

		// Get source refs - P3 Fix: Return errors
		sourceRefs, err := r.getSourceRefs(ctx, entity.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to get source refs for %s: %w", entity.ID, err)
		}
		entity.SourceRefs = sourceRefs
		entities = append(entities, entity)
	}

	return entities, nil
}

// AddAlias adds an alias to an entity.
// P1 Fix: Use COALESCE to handle NULL aliases array from newly created entities.
func (r *PostgresEntityRegistry) AddAlias(ctx context.Context, tenantID, id, alias string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE canonical_entities 
		SET aliases = array_append(COALESCE(aliases, '{}'), $1), updated_at = NOW()
		WHERE id = $2 AND tenant_id = $3 AND NOT ($1 = ANY(COALESCE(aliases, '{}')))
	`, alias, id, tenantID)
	if err != nil {
		return fmt.Errorf("failed to add alias: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		// Check if entity exists or alias already exists
		var exists bool
		r.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM canonical_entities WHERE id = $1 AND tenant_id = $2)", id, tenantID).Scan(&exists)
		if !exists {
			return fmt.Errorf("entity not found: %s", id)
		}
		// Alias already exists, which is fine
	}

	return nil
}

// AddSourceRef links a source entity to a canonical entity.
func (r *PostgresEntityRegistry) AddSourceRef(ctx context.Context, tenantID, id string, ref SourceRef) error {
	// First verify the entity exists and belongs to tenant
	var exists bool
	err := r.db.QueryRowContext(ctx, 
		"SELECT EXISTS(SELECT 1 FROM canonical_entities WHERE id = $1 AND tenant_id = $2)",
		id, tenantID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check entity: %w", err)
	}
	if !exists {
		return fmt.Errorf("entity not found: %s", id)
	}

	if ref.LastSynced.IsZero() {
		ref.LastSynced = time.Now()
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO entity_source_refs (entity_id, source, external_id, node_id, url, last_synced)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (entity_id, source, external_id) DO UPDATE SET
			node_id = EXCLUDED.node_id,
			url = EXCLUDED.url,
			last_synced = EXCLUDED.last_synced
	`, id, ref.Source, ref.ExternalID, ref.NodeID, ref.URL, ref.LastSynced)
	if err != nil {
		return fmt.Errorf("failed to add source ref: %w", err)
	}

	// Update entity timestamp
	r.db.ExecContext(ctx, "UPDATE canonical_entities SET updated_at = NOW() WHERE id = $1", id)

	return nil
}

// Merge merges two entities, returning the surviving entity.
func (r *PostgresEntityRegistry) Merge(ctx context.Context, tenantID, survivorID, mergedID string) (*CanonicalEntity, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// P1 Fix: Get both entities with FOR UPDATE to prevent concurrent modifications
	survivor, err := r.getEntityForUpdate(ctx, tx, tenantID, survivorID)
	if err != nil {
		return nil, fmt.Errorf("failed to get survivor: %w", err)
	}
	if survivor == nil {
		return nil, fmt.Errorf("survivor entity not found: %s", survivorID)
	}

	merged, err := r.getEntityForUpdate(ctx, tx, tenantID, mergedID)
	if err != nil {
		return nil, fmt.Errorf("failed to get merged: %w", err)
	}
	if merged == nil {
		return nil, fmt.Errorf("merged entity not found: %s", mergedID)
	}

	// Merge aliases
	aliasSet := make(map[string]bool)
	for _, a := range survivor.Aliases {
		aliasSet[a] = true
	}
	for _, a := range merged.Aliases {
		aliasSet[a] = true
	}
	// Add merged entity's name as an alias
	aliasSet[merged.Name] = true
	
	var newAliases []string
	for a := range aliasSet {
		if a != survivor.Name { // Don't add survivor's name as alias
			newAliases = append(newAliases, a)
		}
	}
	survivor.Aliases = newAliases

	// Merge qualifiers (merged's qualifiers don't override survivor's)
	if survivor.Qualifiers == nil {
		survivor.Qualifiers = make(map[string]string)
	}
	for k, v := range merged.Qualifiers {
		if _, exists := survivor.Qualifiers[k]; !exists {
			survivor.Qualifiers[k] = v
		}
	}

	// Merge properties (merged's properties don't override survivor's)
	if survivor.Properties == nil {
		survivor.Properties = make(map[string]any)
	}
	for k, v := range merged.Properties {
		if _, exists := survivor.Properties[k]; !exists {
			survivor.Properties[k] = v
		}
	}

	// Track merged entity
	survivor.MergedFrom = append(survivor.MergedFrom, mergedID)
	survivor.MergedFrom = append(survivor.MergedFrom, merged.MergedFrom...)

	// P2 Fix: Move source refs to survivor, handling duplicates
	// First, delete any source refs from merged entity that would conflict with survivor
	_, err = tx.ExecContext(ctx, `
		DELETE FROM entity_source_refs 
		WHERE entity_id = $1 
		AND (source, external_id) IN (
			SELECT source, external_id FROM entity_source_refs WHERE entity_id = $2
		)
	`, mergedID, survivorID)
	if err != nil {
		return nil, fmt.Errorf("failed to deduplicate source refs: %w", err)
	}
	
	// Now move remaining source refs to survivor
	_, err = tx.ExecContext(ctx, `
		UPDATE entity_source_refs SET entity_id = $1 WHERE entity_id = $2
	`, survivorID, mergedID)
	if err != nil {
		return nil, fmt.Errorf("failed to move source refs: %w", err)
	}

	// Update survivor
	// P2 Fix: Handle marshal errors to prevent data corruption
	qualifiersJSON, err := json.Marshal(survivor.Qualifiers)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal qualifiers: %w", err)
	}
	propertiesJSON, err := json.Marshal(survivor.Properties)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal properties: %w", err)
	}
	survivor.UpdatedAt = time.Now()

	_, err = tx.ExecContext(ctx, `
		UPDATE canonical_entities 
		SET aliases = $1, qualifiers = $2, properties = $3, merged_from = $4, updated_at = $5
		WHERE id = $6 AND tenant_id = $7
	`, pq.Array(survivor.Aliases), qualifiersJSON, propertiesJSON,
		pq.Array(survivor.MergedFrom), survivor.UpdatedAt, survivorID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to update survivor: %w", err)
	}

	// Delete merged entity
	_, err = tx.ExecContext(ctx, "DELETE FROM canonical_entities WHERE id = $1 AND tenant_id = $2", mergedID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to delete merged entity: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit merge: %w", err)
	}

	// Refresh source refs - P3 Fix: Handle error
	sourceRefs, err := r.getSourceRefs(ctx, survivorID)
	if err != nil {
		return nil, fmt.Errorf("failed to refresh source refs: %w", err)
	}
	survivor.SourceRefs = sourceRefs

	return survivor, nil
}

// getSourceRefs retrieves source refs for an entity.
func (r *PostgresEntityRegistry) getSourceRefs(ctx context.Context, entityID string) ([]SourceRef, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT source, external_id, node_id, url, last_synced
		FROM entity_source_refs WHERE entity_id = $1
	`, entityID)
	if err != nil {
		return nil, fmt.Errorf("failed to get source refs: %w", err)
	}
	defer rows.Close()

	var refs []SourceRef
	for rows.Next() {
		var ref SourceRef
		var nodeID, url sql.NullString
		err := rows.Scan(&ref.Source, &ref.ExternalID, &nodeID, &url, &ref.LastSynced)
		if err != nil {
			return nil, fmt.Errorf("failed to scan source ref: %w", err)
		}
		ref.NodeID = nodeID.String
		ref.URL = url.String
		refs = append(refs, ref)
	}

	return refs, nil
}

// getEntityForUpdate retrieves an entity with row lock for transactional updates.
// P1 Fix: Uses SELECT FOR UPDATE to prevent concurrent modifications during merge.
func (r *PostgresEntityRegistry) getEntityForUpdate(ctx context.Context, tx *sql.Tx, tenantID, id string) (*CanonicalEntity, error) {
	entity := &CanonicalEntity{}
	var qualifiersJSON, propertiesJSON []byte
	var aliases, mergedFrom []string

	err := tx.QueryRowContext(ctx, `
		SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from, created_at, updated_at
		FROM canonical_entities
		WHERE id = $1 AND tenant_id = $2
		FOR UPDATE
	`, id, tenantID).Scan(
		&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
		pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
		pq.Array(&mergedFrom), &entity.CreatedAt, &entity.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get entity for update: %w", err)
	}

	entity.Aliases = aliases
	entity.MergedFrom = mergedFrom

	if err := json.Unmarshal(qualifiersJSON, &entity.Qualifiers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal qualifiers: %w", err)
	}
	if err := json.Unmarshal(propertiesJSON, &entity.Properties); err != nil {
		return nil, fmt.Errorf("failed to unmarshal properties: %w", err)
	}

	// Get source refs (these don't need locking, they'll be updated in transaction)
	entity.SourceRefs, err = r.getSourceRefs(ctx, id)
	if err != nil {
		return nil, err
	}

	return entity, nil
}

// Ensure interface compliance
var _ EntityRegistry = (*PostgresEntityRegistry)(nil)
