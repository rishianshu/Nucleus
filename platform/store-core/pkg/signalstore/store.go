package signalstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Store persists signal definitions and instances.
type Store struct {
	db *sql.DB
}

// Definition represents a signal definition row.
type Definition struct {
	ID             string
	Slug           string
	Title          string
	Description    string
	Status         string
	ImplMode       string
	SourceFamily   string
	EntityKind     string
	Severity       string
	ProcessKind    string
	PolicyKind     string
	Tags           []string
	CDMModelID     string
	SurfaceHints   any
	Owner          string
	DefinitionSpec any
}

// Instance represents a signal instance row.
type Instance struct {
	ID           string
	DefinitionID string
	Status       string
	EntityRef    string
	EntityKind   string
	Severity     string
	Summary      string
	Details      any
	SourceRunID  string
}

// NewFromEnv opens a store using METADATA_DATABASE_URL/DATABASE_URL.
func NewFromEnv() (*Store, error) {
	dsn := os.Getenv("METADATA_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		return nil, errors.New("METADATA_DATABASE_URL or DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// UpsertDefinition ensures a definition exists and returns its id.
func (s *Store) UpsertDefinition(ctx context.Context, def Definition) (string, error) {
	if def.Slug == "" {
		return "", fmt.Errorf("slug is required")
	}
	if def.ID == "" {
		def.ID = uuid.New().String()
	}
	if def.Status == "" {
		def.Status = "ACTIVE"
	}
	if def.ImplMode == "" {
		def.ImplMode = "CODE"
	}
	if def.Severity == "" {
		def.Severity = "INFO"
	}
	if def.Tags == nil {
		def.Tags = []string{}
	}
	// Ensure DefinitionSpec is not nil (violates NOT NULL constraint)
	if def.DefinitionSpec == nil {
		def.DefinitionSpec = map[string]any{}
	}
	const stmt = `
INSERT INTO metadata.signal_definitions
  (id, slug, title, description, status, impl_mode, source_family, entity_kind, process_kind, policy_kind, severity, tags, cdm_model_id, surface_hints, owner, definition_spec, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
ON CONFLICT (slug) DO UPDATE SET
  title=EXCLUDED.title,
  description=EXCLUDED.description,
  status=EXCLUDED.status,
  source_family=EXCLUDED.source_family,
  entity_kind=EXCLUDED.entity_kind,
  process_kind=EXCLUDED.process_kind,
  policy_kind=EXCLUDED.policy_kind,
  severity=EXCLUDED.severity,
  tags=EXCLUDED.tags,
  cdm_model_id=EXCLUDED.cdm_model_id,
  surface_hints=EXCLUDED.surface_hints,
  owner=EXCLUDED.owner,
  definition_spec=EXCLUDED.definition_spec,
  updated_at=now()
RETURNING id;`
	var id string
	// JSON-encode map fields for PostgreSQL JSONB columns
	surfaceHintsJSON, _ := json.Marshal(def.SurfaceHints)
	definitionSpecJSON, _ := json.Marshal(def.DefinitionSpec)
	if err := s.db.QueryRowContext(ctx, stmt,
		def.ID, def.Slug, def.Title, def.Description, def.Status, def.ImplMode, def.SourceFamily, def.EntityKind, def.ProcessKind, def.PolicyKind, def.Severity, pq.Array(def.Tags), nullString(def.CDMModelID), surfaceHintsJSON, def.Owner, definitionSpecJSON,
	).Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

// UpsertInstance inserts or updates a signal instance keyed by (definition_id, entity_ref).
func (s *Store) UpsertInstance(ctx context.Context, inst Instance) error {
	if inst.DefinitionID == "" || inst.EntityRef == "" {
		return fmt.Errorf("definitionId and entityRef are required")
	}
	if inst.ID == "" {
		inst.ID = uuid.New().String()
	}
	if inst.Status == "" {
		inst.Status = "OPEN"
	}
	if inst.Severity == "" {
		inst.Severity = "INFO"
	}
	const stmt = `
INSERT INTO metadata.signal_instances
  (id, definition_id, status, entity_ref, entity_kind, severity, summary, details, source_run_id, first_seen_at, last_seen_at, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),now(),now())
ON CONFLICT (definition_id, entity_ref) DO UPDATE SET
  status=EXCLUDED.status,
  severity=EXCLUDED.severity,
  summary=EXCLUDED.summary,
  details=EXCLUDED.details,
  source_run_id=EXCLUDED.source_run_id,
  last_seen_at=now(),
  updated_at=now();`
	// JSON-encode details map for PostgreSQL JSONB column
	detailsJSON, _ := json.Marshal(inst.Details)
	_, err := s.db.ExecContext(ctx, stmt,
		inst.ID, inst.DefinitionID, inst.Status, inst.EntityRef, inst.EntityKind, inst.Severity, inst.Summary, detailsJSON, inst.SourceRunID,
	)
	return err
}

// ListDefinitions returns definitions filtered by source family (best effort).
func (s *Store) ListDefinitions(ctx context.Context, sourceFamily string) ([]Definition, error) {
	where := "true"
	args := []any{}
	if sourceFamily != "" {
		where = "source_family = $1"
		args = append(args, sourceFamily)
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`SELECT id, slug, title, description, status, impl_mode, source_family, entity_kind, process_kind, policy_kind, severity, tags, definition_spec FROM metadata.signal_definitions WHERE %s`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var defs []Definition
	for rows.Next() {
		var d Definition
		var tags []string
		var spec any
		if err := rows.Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.Status, &d.ImplMode, &d.SourceFamily, &d.EntityKind, &d.ProcessKind, &d.PolicyKind, &d.Severity, pq.Array(&tags), &spec); err != nil {
			return nil, err
		}
		d.Tags = tags
		d.DefinitionSpec = spec
		defs = append(defs, d)
	}
	return defs, rows.Err()
}

// ListInstancesForDefinition returns existing instances for reconciliation.
func (s *Store) ListInstancesForDefinition(ctx context.Context, definitionID string) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, definition_id, entity_ref, entity_kind, severity, status
FROM metadata.signal_instances
WHERE definition_id=$1`, definitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Instance
	for rows.Next() {
		var inst Instance
		if err := rows.Scan(&inst.ID, &inst.DefinitionID, &inst.EntityRef, &inst.EntityKind, &inst.Severity, &inst.Status); err != nil {
			return nil, err
		}
		out = append(out, inst)
	}
	return out, rows.Err()
}

// UpdateInstanceStatus updates status for an instance keyed by (definition_id, entity_ref).
func (s *Store) UpdateInstanceStatus(ctx context.Context, definitionID, entityRef, status string) error {
	if definitionID == "" || entityRef == "" {
		return fmt.Errorf("definitionId and entityRef are required")
	}
	if status == "" {
		status = "RESOLVED"
	}
	_, err := s.db.ExecContext(ctx, `
UPDATE metadata.signal_instances
SET status=$3, updated_at=now()
WHERE definition_id=$1 AND entity_ref=$2`, definitionID, entityRef, status)
	return err
}

func nullString(val string) any {
	if val == "" {
		return nil
	}
	return val
}
