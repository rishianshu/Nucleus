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

	-- Canonical entities table with temporal metadata
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
		-- P1 Fix: Add temporal metadata columns for time-based queries
		first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		activity_count INT NOT NULL DEFAULT 0,
		mention_count INT NOT NULL DEFAULT 0,
		velocity DOUBLE PRECISION NOT NULL DEFAULT 0.0,
		-- P2 Fix: Add remaining temporal fields
		last_mentioned_at TIMESTAMPTZ,
		source_first_seen JSONB DEFAULT '{}',
		source_last_seen JSONB DEFAULT '{}',
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

	// Execute main schema
	_, err := r.db.Exec(schema)
	if err != nil {
		return err
	}

	// P0 Fix: Add temporal columns for existing tables via ALTER TABLE
	// These are safe to run multiple times due to IF NOT EXISTS semantics
	alterStatements := []string{
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW()`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS activity_count INT DEFAULT 0`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS mention_count INT DEFAULT 0`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS velocity DOUBLE PRECISION DEFAULT 0.0`,
		// P2 Fix: Add remaining temporal fields for full coverage
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS last_mentioned_at TIMESTAMPTZ`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS source_first_seen JSONB DEFAULT '{}'`,
		`ALTER TABLE canonical_entities ADD COLUMN IF NOT EXISTS source_last_seen JSONB DEFAULT '{}'`,
	}

	for _, stmt := range alterStatements {
		_, err := r.db.Exec(stmt)
		if err != nil {
			return err
		}
	}

	// P1 Fix: Backfill temporal columns from historical timestamps for existing rows
	// This preserves the original created_at as first_seen_at and updated_at as last_activity_at
	// Only updates rows where first_seen_at still has the migration default (NOW() > created_at)
	backfillStatements := []string{
		// Backfill first_seen_at from created_at where it wasn't set correctly
		`UPDATE canonical_entities SET first_seen_at = created_at WHERE first_seen_at > created_at + INTERVAL '1 second'`,
		// Backfill last_seen_at from updated_at
		`UPDATE canonical_entities SET last_seen_at = updated_at WHERE last_seen_at > updated_at + INTERVAL '1 second'`,
		// Backfill last_activity_at from updated_at
		`UPDATE canonical_entities SET last_activity_at = updated_at WHERE last_activity_at > updated_at + INTERVAL '1 second'`,
	}

	for _, stmt := range backfillStatements {
		_, err := r.db.Exec(stmt)
		if err != nil {
			// Non-fatal: backfill errors shouldn't block schema migration
			// Log would be ideal but we don't have logger access here
			continue
		}
	}

	// P1 Fix: Create temporal indexes AFTER columns exist
	// Moved from schema block to ensure backward-compatible migration
	temporalIndexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_entities_last_activity ON canonical_entities(tenant_id, last_activity_at)`,
		`CREATE INDEX IF NOT EXISTS idx_entities_activity_count ON canonical_entities(tenant_id, activity_count)`,
		`CREATE INDEX IF NOT EXISTS idx_entities_velocity ON canonical_entities(tenant_id, velocity)`,
	}

	for _, stmt := range temporalIndexes {
		_, err := r.db.Exec(stmt)
		if err != nil {
			return err
		}
	}

	return nil
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

	// P1 Fix: Initialize temporal metadata if not set
	if entity.Temporal.FirstSeenAt.IsZero() {
		entity.Temporal.FirstSeenAt = entity.CreatedAt
	}
	if entity.Temporal.LastSeenAt.IsZero() {
		entity.Temporal.LastSeenAt = entity.CreatedAt
	}
	if entity.Temporal.LastActivityAt.IsZero() {
		entity.Temporal.LastActivityAt = entity.CreatedAt
	}

	qualifiersJSON, err := json.Marshal(entity.Qualifiers)
	if err != nil {
		return fmt.Errorf("failed to marshal qualifiers: %w", err)
	}

	propertiesJSON, err := json.Marshal(entity.Properties)
	if err != nil {
		return fmt.Errorf("failed to marshal properties: %w", err)
	}

	// P1 Fix: Ensure nil maps marshal to '{}' instead of 'null'
	sourceFirstSeen := entity.Temporal.SourceFirstSeen
	if sourceFirstSeen == nil {
		sourceFirstSeen = make(map[string]time.Time)
	}
	sourceLastSeen := entity.Temporal.SourceLastSeen
	if sourceLastSeen == nil {
		sourceLastSeen = make(map[string]time.Time)
	}

	sourceFirstSeenJSON, err := json.Marshal(sourceFirstSeen)
	if err != nil {
		return fmt.Errorf("failed to marshal source_first_seen: %w", err)
	}
	sourceLastSeenJSON, err := json.Marshal(sourceLastSeen)
	if err != nil {
		return fmt.Errorf("failed to marshal source_last_seen: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// P2 Fix: Insert entity with ALL temporal columns (including JSONB maps)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO canonical_entities 
		(id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from,
		 first_seen_at, last_seen_at, last_activity_at, activity_count, mention_count, velocity,
		 last_mentioned_at, source_first_seen, source_last_seen,
		 created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
	`, entity.ID, entity.TenantID, entity.Type, entity.Name,
		pq.Array(entity.Aliases), qualifiersJSON, propertiesJSON,
		pq.Array(entity.MergedFrom),
		entity.Temporal.FirstSeenAt, entity.Temporal.LastSeenAt, entity.Temporal.LastActivityAt,
		entity.Temporal.ActivityCount, entity.Temporal.MentionCount, entity.Temporal.Velocity,
		entity.Temporal.LastMentionedAt, sourceFirstSeenJSON, sourceLastSeenJSON,
		entity.CreatedAt, entity.UpdatedAt)
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
	var sourceFirstSeenJSON, sourceLastSeenJSON []byte
	var aliases, mergedFrom []string

	// P2 Fix: Include ALL temporal columns in SELECT
	err := r.db.QueryRowContext(ctx, `
		SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from,
		       first_seen_at, last_seen_at, last_activity_at, activity_count, mention_count, velocity,
		       last_mentioned_at, source_first_seen, source_last_seen,
		       created_at, updated_at
		FROM canonical_entities
		WHERE id = $1 AND tenant_id = $2
	`, id, tenantID).Scan(
		&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
		pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
		pq.Array(&mergedFrom),
		&entity.Temporal.FirstSeenAt, &entity.Temporal.LastSeenAt,
		&entity.Temporal.LastActivityAt, &entity.Temporal.ActivityCount,
		&entity.Temporal.MentionCount, &entity.Temporal.Velocity,
		&entity.Temporal.LastMentionedAt, &sourceFirstSeenJSON, &sourceLastSeenJSON,
		&entity.CreatedAt, &entity.UpdatedAt)

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
	// P2 Fix: Unmarshal source-specific temporal maps
	if len(sourceFirstSeenJSON) > 0 {
		if err := json.Unmarshal(sourceFirstSeenJSON, &entity.Temporal.SourceFirstSeen); err != nil {
			return nil, fmt.Errorf("failed to unmarshal source_first_seen: %w", err)
		}
	}
	if len(sourceLastSeenJSON) > 0 {
		if err := json.Unmarshal(sourceLastSeenJSON, &entity.Temporal.SourceLastSeen); err != nil {
			return nil, fmt.Errorf("failed to unmarshal source_last_seen: %w", err)
		}
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
	// P1 Fix: Update last_seen_at on every update
	entity.Temporal.LastSeenAt = entity.UpdatedAt

	qualifiersJSON, err := json.Marshal(entity.Qualifiers)
	if err != nil {
		return fmt.Errorf("failed to marshal qualifiers: %w", err)
	}

	propertiesJSON, err := json.Marshal(entity.Properties)
	if err != nil {
		return fmt.Errorf("failed to marshal properties: %w", err)
	}

	// P1 Fix: Ensure nil maps marshal to '{}' instead of 'null'
	sourceFirstSeen := entity.Temporal.SourceFirstSeen
	if sourceFirstSeen == nil {
		sourceFirstSeen = make(map[string]time.Time)
	}
	sourceLastSeen := entity.Temporal.SourceLastSeen
	if sourceLastSeen == nil {
		sourceLastSeen = make(map[string]time.Time)
	}

	sourceFirstSeenJSON, err := json.Marshal(sourceFirstSeen)
	if err != nil {
		return fmt.Errorf("failed to marshal source_first_seen: %w", err)
	}
	sourceLastSeenJSON, err := json.Marshal(sourceLastSeen)
	if err != nil {
		return fmt.Errorf("failed to marshal source_last_seen: %w", err)
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// P1 Fix: Use COALESCE/NULLIF to preserve existing temporal values when caller passes empty,
	// with -1 sentinels on counters/velocity so zero updates are applied while -1 preserves.
	result, err := tx.ExecContext(ctx, `
		UPDATE canonical_entities 
		SET entity_type = $1, name = $2, aliases = $3, qualifiers = $4, 
		    properties = $5, merged_from = $6,
		    last_seen_at = $7,
		    last_activity_at = COALESCE(NULLIF($8, '0001-01-01 00:00:00+00'::timestamptz), last_activity_at),
		    activity_count = COALESCE(NULLIF($9, -1), activity_count),
		    mention_count = COALESCE(NULLIF($10, -1), mention_count),
		    velocity = COALESCE(NULLIF($11, -1), velocity),
		    last_mentioned_at = COALESCE($12, last_mentioned_at),
		    source_first_seen = CASE WHEN $13::jsonb = '{}'::jsonb THEN source_first_seen ELSE $13 END,
		    source_last_seen = CASE WHEN $14::jsonb = '{}'::jsonb THEN source_last_seen ELSE $14 END,
		    updated_at = $15
		WHERE id = $16 AND tenant_id = $17
	`, entity.Type, entity.Name, pq.Array(entity.Aliases), qualifiersJSON,
		propertiesJSON, pq.Array(entity.MergedFrom),
		entity.Temporal.LastSeenAt, entity.Temporal.LastActivityAt,
		entity.Temporal.ActivityCount, entity.Temporal.MentionCount, entity.Temporal.Velocity,
		entity.Temporal.LastMentionedAt, sourceFirstSeenJSON, sourceLastSeenJSON,
		entity.UpdatedAt, entity.ID, entity.TenantID)
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
	// P2 Fix: Include ALL temporal columns in SELECT
	query.WriteString(`SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from, 
		first_seen_at, last_seen_at, last_activity_at, activity_count, mention_count, velocity,
		last_mentioned_at, source_first_seen, source_last_seen,
		created_at, updated_at FROM canonical_entities WHERE tenant_id = $1`)
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

	// P0 Fix: Add nil checks for pointer-based temporal filters
	if filter.UpdatedAfter != nil && !filter.UpdatedAfter.IsZero() {
		query.WriteString(fmt.Sprintf(" AND updated_at > $%d", argNum))
		args = append(args, *filter.UpdatedAfter)
		argNum++
	}

	// Additional temporal filters
	if filter.FirstSeenAfter != nil && !filter.FirstSeenAfter.IsZero() {
		query.WriteString(fmt.Sprintf(" AND first_seen_at > $%d", argNum))
		args = append(args, *filter.FirstSeenAfter)
		argNum++
	}

	if filter.FirstSeenBefore != nil && !filter.FirstSeenBefore.IsZero() {
		query.WriteString(fmt.Sprintf(" AND first_seen_at < $%d", argNum))
		args = append(args, *filter.FirstSeenBefore)
		argNum++
	}

	// P1 Fix: Add activity-based temporal filters
	if filter.LastActivityAfter != nil && !filter.LastActivityAfter.IsZero() {
		query.WriteString(fmt.Sprintf(" AND last_activity_at > $%d", argNum))
		args = append(args, *filter.LastActivityAfter)
		argNum++
	}

	if filter.LastActivityBefore != nil && !filter.LastActivityBefore.IsZero() {
		query.WriteString(fmt.Sprintf(" AND last_activity_at < $%d", argNum))
		args = append(args, *filter.LastActivityBefore)
		argNum++
	}

	if filter.MinActivityCount > 0 {
		query.WriteString(fmt.Sprintf(" AND activity_count >= $%d", argNum))
		args = append(args, filter.MinActivityCount)
		argNum++
	}

	if filter.MinMentionCount > 0 {
		query.WriteString(fmt.Sprintf(" AND mention_count >= $%d", argNum))
		args = append(args, filter.MinMentionCount)
		argNum++
	}

	if filter.MinVelocity > 0 {
		query.WriteString(fmt.Sprintf(" AND velocity >= $%d", argNum))
		args = append(args, filter.MinVelocity)
		argNum++
	}

	// Point-in-time query: entities that existed as of given time
	if filter.AsOf != nil && !filter.AsOf.IsZero() {
		query.WriteString(fmt.Sprintf(" AND first_seen_at <= $%d", argNum))
		args = append(args, *filter.AsOf)
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
		var sourceFirstSeenJSON, sourceLastSeenJSON []byte
		var aliases, mergedFrom []string

		// P2 Fix: Scan ALL temporal columns into TemporalMetadata
		err := rows.Scan(
			&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
			pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
			pq.Array(&mergedFrom),
			&entity.Temporal.FirstSeenAt, &entity.Temporal.LastSeenAt,
			&entity.Temporal.LastActivityAt, &entity.Temporal.ActivityCount,
			&entity.Temporal.MentionCount, &entity.Temporal.Velocity,
			&entity.Temporal.LastMentionedAt, &sourceFirstSeenJSON, &sourceLastSeenJSON,
			&entity.CreatedAt, &entity.UpdatedAt)
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
		// P2 Fix: Unmarshal source-specific temporal maps
		if len(sourceFirstSeenJSON) > 0 {
			if err := json.Unmarshal(sourceFirstSeenJSON, &entity.Temporal.SourceFirstSeen); err != nil {
				return nil, fmt.Errorf("failed to unmarshal source_first_seen for %s: %w", entity.ID, err)
			}
		}
		if len(sourceLastSeenJSON) > 0 {
			if err := json.Unmarshal(sourceLastSeenJSON, &entity.Temporal.SourceLastSeen); err != nil {
				return nil, fmt.Errorf("failed to unmarshal source_last_seen for %s: %w", entity.ID, err)
			}
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
	var sourceFirstSeenJSON, sourceLastSeenJSON []byte
	var aliases, mergedFrom []string

	err := tx.QueryRowContext(ctx, `
		SELECT id, tenant_id, entity_type, name, aliases, qualifiers, properties, merged_from,
		       first_seen_at, last_seen_at, last_activity_at, activity_count, mention_count, velocity,
		       last_mentioned_at, source_first_seen, source_last_seen,
		       created_at, updated_at
		FROM canonical_entities
		WHERE id = $1 AND tenant_id = $2
		FOR UPDATE
	`, id, tenantID).Scan(
		&entity.ID, &entity.TenantID, &entity.Type, &entity.Name,
		pq.Array(&aliases), &qualifiersJSON, &propertiesJSON,
		pq.Array(&mergedFrom),
		&entity.Temporal.FirstSeenAt, &entity.Temporal.LastSeenAt,
		&entity.Temporal.LastActivityAt, &entity.Temporal.ActivityCount,
		&entity.Temporal.MentionCount, &entity.Temporal.Velocity,
		&entity.Temporal.LastMentionedAt, &sourceFirstSeenJSON, &sourceLastSeenJSON,
		&entity.CreatedAt, &entity.UpdatedAt)

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
	if len(sourceFirstSeenJSON) > 0 {
		if err := json.Unmarshal(sourceFirstSeenJSON, &entity.Temporal.SourceFirstSeen); err != nil {
			return nil, fmt.Errorf("failed to unmarshal source_first_seen: %w", err)
		}
	}
	if len(sourceLastSeenJSON) > 0 {
		if err := json.Unmarshal(sourceLastSeenJSON, &entity.Temporal.SourceLastSeen); err != nil {
			return nil, fmt.Errorf("failed to unmarshal source_last_seen: %w", err)
		}
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
