package activities

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"
)

type registryClient struct {
	db *sql.DB
}

type materializedArtifact struct {
	ID             string
	TenantID       string
	SourceFamily   string
	SinkEndpointID string
	Handle         map[string]any
}

type runSummary struct {
	ArtifactID      string
	TenantID        string
	SourceFamily    string
	SinkEndpointID  string
	VersionHash     string
	NodesTouched    int64
	EdgesTouched    int64
	CacheHits       int64
	LogEventsPath   string
	LogSnapshotPath string
}

func newRegistryClient() (*registryClient, error) {
	dsn := os.Getenv("METADATA_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		return nil, nil
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	return &registryClient{db: db}, nil
}

func (c *registryClient) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	return c.db.Close()
}

func (c *registryClient) markIndexing(ctx context.Context, artifactID string) {
	if c == nil || c.db == nil || artifactID == "" {
		return
	}
	_, _ = c.db.ExecContext(ctx, `
UPDATE metadata.materialized_artifacts
SET status='INDEXING', index_status='INDEXING', index_last_error=NULL, updated_at=now()
WHERE id=$1`, artifactID)
}

func (c *registryClient) markIndexed(ctx context.Context, artifactID string, counters map[string]any) {
	if c == nil || c.db == nil || artifactID == "" {
		return
	}
	_, _ = c.db.ExecContext(ctx, `
UPDATE metadata.materialized_artifacts
SET status='INDEXED', index_status='INDEXED', index_counters=$2, index_last_error=NULL, updated_at=now()
WHERE id=$1`, artifactID, counters)
}

func (c *registryClient) markIndexFailed(ctx context.Context, artifactID string, lastError any) {
	if c == nil || c.db == nil || artifactID == "" {
		return
	}
	_, _ = c.db.ExecContext(ctx, `
UPDATE metadata.materialized_artifacts
SET status='FAILED', index_status='FAILED', index_last_error=$2, updated_at=now()
WHERE id=$1`, artifactID, lastError)
}

func (c *registryClient) markClustered(ctx context.Context, artifactID string, counters map[string]any) {
	if c == nil || c.db == nil || artifactID == "" {
		return
	}
	// Merge counters into existing index_counters to preserve indexing stats.
	payload, _ := json.Marshal(counters)
	_, _ = c.db.ExecContext(ctx, `
UPDATE metadata.materialized_artifacts
SET index_counters = COALESCE(index_counters, '{}'::jsonb) || $2::jsonb,
    updated_at = now()
WHERE id = $1`, artifactID, payload)
}

func (c *registryClient) getArtifact(ctx context.Context, artifactID string) (*materializedArtifact, error) {
	if c == nil || c.db == nil || artifactID == "" {
		return nil, fmt.Errorf("artifactID is required")
	}
	row := c.db.QueryRowContext(ctx, `
SELECT id, tenant_id, source_family, sink_endpoint_id, handle
FROM metadata.materialized_artifacts
WHERE id=$1`, artifactID)
	var art materializedArtifact
	var handleBytes []byte
	if err := row.Scan(&art.ID, &art.TenantID, &art.SourceFamily, &art.SinkEndpointID, &handleBytes); err != nil {
		return nil, err
	}
	if len(handleBytes) > 0 {
		_ = json.Unmarshal(handleBytes, &art.Handle)
	}
	return &art, nil
}

// getRunSummary reads index_counters for an artifact and returns a summary for UI/CLI use.
func (c *registryClient) getRunSummary(ctx context.Context, artifactID string) (*runSummary, error) {
	if c == nil || c.db == nil || artifactID == "" {
		return nil, fmt.Errorf("artifactID is required")
	}
	row := c.db.QueryRowContext(ctx, `
SELECT tenant_id, source_family, sink_endpoint_id, index_counters
FROM metadata.materialized_artifacts
WHERE id=$1`, artifactID)
	var tenantID, sourceFamily, sinkID string
	var countersBytes []byte
	if err := row.Scan(&tenantID, &sourceFamily, &sinkID, &countersBytes); err != nil {
		return nil, err
	}
	out := &runSummary{
		ArtifactID:     artifactID,
		TenantID:       tenantID,
		SourceFamily:   sourceFamily,
		SinkEndpointID: sinkID,
	}
	if len(countersBytes) > 0 {
		var counters map[string]any
		if err := json.Unmarshal(countersBytes, &counters); err == nil {
			out.VersionHash, _ = counters["versionHash"].(string)
			out.LogEventsPath, _ = counters["logEventsPath"].(string)
			out.LogSnapshotPath, _ = counters["logSnapshotPath"].(string)
			if v, ok := counters["nodesTouched"].(float64); ok {
				out.NodesTouched = int64(v)
			}
			if v, ok := counters["edgesTouched"].(float64); ok {
				out.EdgesTouched = int64(v)
			}
			if v, ok := counters["cacheHits"].(float64); ok {
				out.CacheHits = int64(v)
			}
		}
	}
	return out, nil
}
