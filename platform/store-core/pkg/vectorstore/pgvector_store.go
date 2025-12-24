package vectorstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

// PgVectorStore implements Store backed by Postgres + pgvector.
type PgVectorStore struct {
	db        *sql.DB
	dimension int
}

// NewPgVectorStore connects to Postgres (with pgvector) and ensures the table exists.
func NewPgVectorStore(dsn string, dimension int) (*PgVectorStore, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	return NewPgVectorStoreFromDB(db, dimension)
}

// NewPgVectorStoreFromDB reuses an existing *sql.DB (for example via pgxpool/stdlib).
func NewPgVectorStoreFromDB(db *sql.DB, dimension int) (*PgVectorStore, error) {
	if db == nil {
		return nil, errors.New("db is required")
	}
	if dimension <= 0 {
		dimension = 1536
	}
	store := &PgVectorStore{db: db, dimension: dimension}
	if err := store.ensureTables(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *PgVectorStore) ensureTables() error {
	ddl := fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS vector_entries (
  tenant_id        text NOT NULL,
  project_id       text NOT NULL,
  profile_id       text NOT NULL,
  node_id          text NOT NULL,
  source_family    text,
  artifact_id      text,
  run_id           text,
  sink_endpoint_id text,
  dataset_slug     text,
  entity_kind      text,
  labels           text[],
  tags             text[],
  content_text     text,
  metadata         jsonb,
  raw_payload      jsonb,
  raw_metadata     jsonb,
  embedding        vector(%d),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, profile_id, node_id)
);
CREATE INDEX IF NOT EXISTS vector_entries_profile_idx ON vector_entries (tenant_id, project_id, profile_id);
CREATE INDEX IF NOT EXISTS vector_entries_artifact_idx ON vector_entries (tenant_id, artifact_id, run_id);
CREATE INDEX IF NOT EXISTS vector_entries_meta_idx ON vector_entries USING gin (metadata);
CREATE INDEX IF NOT EXISTS vector_entries_embedding_idx ON vector_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`, s.dimension)
	_, err := s.db.Exec(ddl)
	return err
}

func (s *PgVectorStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// UpsertEntries inserts or updates entries with embeddings.
func (s *PgVectorStore) UpsertEntries(entries []Entry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt := `
INSERT INTO vector_entries
 (tenant_id, project_id, profile_id, node_id, source_family, artifact_id, run_id, sink_endpoint_id, dataset_slug, entity_kind, labels, tags, content_text, metadata, raw_payload, raw_metadata, embedding, updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
 ON CONFLICT (tenant_id, project_id, profile_id, node_id) DO UPDATE SET
   source_family=EXCLUDED.source_family,
   artifact_id=EXCLUDED.artifact_id,
   run_id=EXCLUDED.run_id,
   sink_endpoint_id=EXCLUDED.sink_endpoint_id,
   dataset_slug=EXCLUDED.dataset_slug,
   entity_kind=EXCLUDED.entity_kind,
   labels=EXCLUDED.labels,
   tags=EXCLUDED.tags,
   content_text=EXCLUDED.content_text,
   metadata=EXCLUDED.metadata,
   raw_payload=EXCLUDED.raw_payload,
   raw_metadata=EXCLUDED.raw_metadata,
   embedding=EXCLUDED.embedding,
   updated_at=now();
`
	for _, e := range entries {
		metaBytes, _ := json.Marshal(e.Metadata)
		rawPayload, _ := json.Marshal(e.RawPayload)
		rawMeta, _ := json.Marshal(e.RawMetadata)
		embLit, err := toVectorLiteral(e.Embedding, s.dimension)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(stmt,
			e.TenantID, e.ProjectID, e.ProfileID, e.NodeID, e.SourceFamily, e.ArtifactID, e.RunID, e.SinkEndpointID, e.DatasetSlug, e.EntityKind,
			pq.Array(e.Labels), pq.Array(e.Tags), e.ContentText, metaBytes, rawPayload, rawMeta, embLit, time.Now().UTC(),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Query performs similarity search with filters.
func (s *PgVectorStore) Query(embedding []float32, filter QueryFilter, topK int) ([]SearchResult, error) {
	if topK <= 0 {
		topK = 10
	}
	embLit, err := toVectorLiteral(embedding, s.dimension)
	if err != nil {
		return nil, err
	}

	where := []string{"tenant_id = $1"}
	args := []any{filter.TenantID}

	argIdx := 2
	if filter.ProjectID != "" {
		where = append(where, fmt.Sprintf("project_id = $%d", argIdx))
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if len(filter.ProfileIDs) > 0 {
		where = append(where, fmt.Sprintf("profile_id = ANY($%d)", argIdx))
		args = append(args, pq.Array(filter.ProfileIDs))
		argIdx++
	}
	if filter.SourceFamily != "" {
		where = append(where, fmt.Sprintf("source_family = $%d", argIdx))
		args = append(args, filter.SourceFamily)
		argIdx++
	}
	if filter.ArtifactID != "" {
		where = append(where, fmt.Sprintf("artifact_id = $%d", argIdx))
		args = append(args, filter.ArtifactID)
		argIdx++
	}
	if filter.RunID != "" {
		where = append(where, fmt.Sprintf("run_id = $%d", argIdx))
		args = append(args, filter.RunID)
		argIdx++
	}
	if filter.SinkEndpointID != "" {
		where = append(where, fmt.Sprintf("sink_endpoint_id = $%d", argIdx))
		args = append(args, filter.SinkEndpointID)
		argIdx++
	}
	if filter.DatasetSlug != "" {
		where = append(where, fmt.Sprintf("dataset_slug = $%d", argIdx))
		args = append(args, filter.DatasetSlug)
		argIdx++
	}
	if len(filter.EntityKinds) > 0 {
		where = append(where, fmt.Sprintf("entity_kind = ANY($%d)", argIdx))
		args = append(args, pq.Array(filter.EntityKinds))
		argIdx++
	}
	if len(filter.Labels) > 0 {
		where = append(where, fmt.Sprintf("labels && $%d", argIdx))
		args = append(args, pq.Array(filter.Labels))
		argIdx++
	}
	if len(filter.Tags) > 0 {
		where = append(where, fmt.Sprintf("tags && $%d", argIdx))
		args = append(args, pq.Array(filter.Tags))
		argIdx++
	}
	if filter.SinceUpdatedAt != nil {
		where = append(where, fmt.Sprintf("updated_at >= $%d", argIdx))
		args = append(args, *filter.SinceUpdatedAt)
		argIdx++
	}

	whereSQL := strings.Join(where, " AND ")
	query := fmt.Sprintf(`
SELECT node_id, profile_id, 1 - (embedding <=> %s) AS score, content_text, metadata, raw_metadata, raw_payload
FROM vector_entries
WHERE %s
ORDER BY embedding <=> %s
LIMIT %d;
`, embLit, whereSQL, embLit, topK)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		var metaBytes, rawMetaBytes, rawPayloadBytes []byte
		if err := rows.Scan(&r.NodeID, &r.ProfileID, &r.Score, &r.ContentText, &metaBytes, &rawMetaBytes, &rawPayloadBytes); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(metaBytes, &r.Metadata)
		_ = json.Unmarshal(rawMetaBytes, &r.RawMetadata)
		_ = json.Unmarshal(rawPayloadBytes, &r.RawPayload)
		results = append(results, r)
	}
	return results, rows.Err()
}

// DeleteByArtifact removes entries produced by a specific artifact/run.
func (s *PgVectorStore) DeleteByArtifact(tenantID, artifactID, runID string) error {
	_, err := s.db.Exec(`DELETE FROM vector_entries WHERE tenant_id = $1 AND artifact_id = $2 AND ($3 = '' OR run_id = $3)`, tenantID, artifactID, runID)
	return err
}

// ListEntries returns recent entries matching the filter (limited).
func (s *PgVectorStore) ListEntries(filter QueryFilter, limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{filter.TenantID}
	argIdx := 2
	if filter.ProjectID != "" {
		where = append(where, fmt.Sprintf("project_id = $%d", argIdx))
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if len(filter.ProfileIDs) > 0 {
		where = append(where, fmt.Sprintf("profile_id = ANY($%d)", argIdx))
		args = append(args, pq.Array(filter.ProfileIDs))
		argIdx++
	}
	if filter.SourceFamily != "" {
		where = append(where, fmt.Sprintf("source_family = $%d", argIdx))
		args = append(args, filter.SourceFamily)
		argIdx++
	}
	whereSQL := strings.Join(where, " AND ")
	query := fmt.Sprintf(`SELECT tenant_id, project_id, profile_id, node_id, content_text, metadata, raw_payload, raw_metadata, updated_at FROM vector_entries WHERE %s ORDER BY updated_at DESC LIMIT %d`, whereSQL, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Entry
	for rows.Next() {
		var e Entry
		var metaBytes, rawPayloadBytes, rawMetaBytes []byte
		if err := rows.Scan(&e.TenantID, &e.ProjectID, &e.ProfileID, &e.NodeID, &e.ContentText, &metaBytes, &rawPayloadBytes, &rawMetaBytes, &e.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(metaBytes, &e.Metadata)
		_ = json.Unmarshal(rawPayloadBytes, &e.RawPayload)
		_ = json.Unmarshal(rawMetaBytes, &e.RawMetadata)
		list = append(list, e)
	}
	return list, rows.Err()
}

func toVectorLiteral(embedding []float32, dim int) (string, error) {
	if len(embedding) == 0 {
		return "", errors.New("embedding is required")
	}
	if dim > 0 && len(embedding) != dim {
		return "", fmt.Errorf("embedding length %d does not match dimension %d", len(embedding), dim)
	}
	parts := make([]string, len(embedding))
	for i, v := range embedding {
		parts[i] = strconv.FormatFloat(float64(v), 'f', -1, 32)
	}
	return fmt.Sprintf("[%s]", strings.Join(parts, ",")), nil
}
