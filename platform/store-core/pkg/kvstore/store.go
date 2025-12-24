package kvstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// Record represents a scoped KV entry.
type Record struct {
	TenantID  string
	ProjectID string
	Key       string
	Value     []byte
	Version   int64
}

// Store defines the KV operations.
type Store interface {
	Put(ctx context.Context, rec Record, expectedVersion int64) (int64, error)
	Get(ctx context.Context, tenantID, projectID, key string) (*Record, error)
	Delete(ctx context.Context, tenantID, projectID, key string, expectedVersion int64) (bool, error)
	ListKeys(ctx context.Context, tenantID, projectID, prefix string, limit int) ([]string, error)
	Close() error
}

// PostgresStore implements Store backed by Postgres.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore connects to Postgres and ensures schema exists.
func NewPostgresStore() (*PostgresStore, error) {
	dsn := os.Getenv("KV_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		dsn = os.Getenv("METADATA_DATABASE_URL")
	}
	if dsn == "" {
		return nil, errors.New("KV_DATABASE_URL/DATABASE_URL not set")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	return NewPostgresStoreWithDB(db)
}

// NewPostgresStoreWithDB reuses an existing *sql.DB (for example opened via pgxpool/stdlib).
func NewPostgresStoreWithDB(db *sql.DB) (*PostgresStore, error) {
	if db == nil {
		return nil, errors.New("db is required")
	}
	if err := ensureTable(db); err != nil {
		return nil, err
	}
	return &PostgresStore{db: db}, nil
}

func ensureTable(db *sql.DB) error {
	const ddl = `
CREATE TABLE IF NOT EXISTS kv_store (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, key)
);
`
	_, err := db.Exec(ddl)
	return err
}

func (s *PostgresStore) Put(ctx context.Context, rec Record, expectedVersion int64) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var currentVersion int64
	err = tx.QueryRowContext(ctx, `SELECT version FROM kv_store WHERE tenant_id=$1 AND project_id=$2 AND key=$3`,
		rec.TenantID, rec.ProjectID, rec.Key).Scan(&currentVersion)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if expectedVersion > 0 {
				return 0, fmt.Errorf("version mismatch: expected %d but key missing", expectedVersion)
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO kv_store (tenant_id, project_id, key, value, version) VALUES ($1,$2,$3,$4,1)`,
				rec.TenantID, rec.ProjectID, rec.Key, rec.Value)
			if err != nil {
				return 0, err
			}
			if err := tx.Commit(); err != nil {
				return 0, err
			}
			return 1, nil
		}
		return 0, err
	}
	// existing row
	if expectedVersion > 0 && currentVersion != expectedVersion {
		return 0, fmt.Errorf("version mismatch: expected %d got %d", expectedVersion, currentVersion)
	}
	nextVersion := currentVersion + 1
	_, err = tx.ExecContext(ctx, `UPDATE kv_store SET value=$1, version=$2, updated_at=now() WHERE tenant_id=$3 AND project_id=$4 AND key=$5`,
		rec.Value, nextVersion, rec.TenantID, rec.ProjectID, rec.Key)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return nextVersion, nil
}

func (s *PostgresStore) Get(ctx context.Context, tenantID, projectID, key string) (*Record, error) {
	var rec Record
	err := s.db.QueryRowContext(ctx, `SELECT value, version FROM kv_store WHERE tenant_id=$1 AND project_id=$2 AND key=$3`,
		tenantID, projectID, key).Scan(&rec.Value, &rec.Version)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	rec.TenantID = tenantID
	rec.ProjectID = projectID
	rec.Key = key
	return &rec, nil
}

func (s *PostgresStore) Delete(ctx context.Context, tenantID, projectID, key string, expectedVersion int64) (bool, error) {
	if expectedVersion > 0 {
		res, err := s.db.ExecContext(ctx, `DELETE FROM kv_store WHERE tenant_id=$1 AND project_id=$2 AND key=$3 AND version=$4`,
			tenantID, projectID, key, expectedVersion)
		if err != nil {
			return false, err
		}
		affected, _ := res.RowsAffected()
		return affected == 1, nil
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM kv_store WHERE tenant_id=$1 AND project_id=$2 AND key=$3`,
		tenantID, projectID, key)
	if err != nil {
		return false, err
	}
	affected, _ := res.RowsAffected()
	return affected == 1, nil
}

func (s *PostgresStore) ListKeys(ctx context.Context, tenantID, projectID, prefix string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT key FROM kv_store WHERE tenant_id=$1 AND project_id=$2 AND key LIKE $3 ORDER BY key LIMIT $4`,
		tenantID, projectID, prefix+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *PostgresStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
