package logstore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	minioep "github.com/nucleus/ucl-core/internal/connector/minio"
)

// MinioStore implements Store using a MinIO object store (or local store for dev).
type MinioStore struct {
	store      minioep.ObjectStore
	bucket     string
	basePrefix string
}

// NewMinioStoreFromEnv builds a log store using MINIO_* or local fallback.
func NewMinioStoreFromEnv() (*MinioStore, error) {
	bucket := getenv("LOGSTORE_BUCKET", "logstore")
	prefix := getenv("LOGSTORE_PREFIX", "logs")

	endpoint := getenv("MINIO_ENDPOINT", "")
	access := getenv("MINIO_ACCESS_KEY", "")
	secret := getenv("MINIO_SECRET_KEY", "")
	useSSL := getenv("MINIO_USE_SSL", "false") == "true"

	var store minioep.ObjectStore
	if endpoint != "" && access != "" && secret != "" {
		client, err := minioep.NewS3Client(minioep.ParseConfig(map[string]any{
			"endpointUrl":     endpoint,
			"accessKeyId":     access,
			"secretAccessKey": secret,
			"useSSL":          useSSL,
			"bucket":          bucket,
			"basePrefix":      prefix,
		}))
		if err != nil {
			return nil, err
		}
		store = client
	} else {
		// local fallback for dev/tests
		root := filepath.Join(os.TempDir(), "logstore")
		store = minioep.NewLocalStore(root)
	}
	return &MinioStore{store: store, bucket: bucket, basePrefix: prefix}, nil
}

func (s *MinioStore) CreateTable(ctx context.Context, table string) error {
	if err := s.store.EnsureBucket(ctx, s.bucket); err != nil {
		return err
	}
	// best-effort placeholder object to ensure prefix exists
	key := s.path(table, "._init")
	return s.store.PutObject(ctx, s.bucket, key, []byte("init"))
}

func (s *MinioStore) Append(ctx context.Context, table, runID string, records []Record) (string, error) {
	if len(records) == 0 {
		return "", nil
	}
	if err := s.store.EnsureBucket(ctx, s.bucket); err != nil {
		return "", err
	}
	var buf bytes.Buffer
	for _, r := range records {
		line, _ := jsonMarshal(r)
		buf.Write(line)
		buf.WriteByte('\n')
	}
	key := s.path(table, fmt.Sprintf("%s-%d.jsonl", runID, time.Now().UnixNano()))
	if err := s.store.PutObject(ctx, s.bucket, key, buf.Bytes()); err != nil {
		return "", err
	}
	return fmt.Sprintf("minio://%s/%s", s.bucket, key), nil
}

func (s *MinioStore) WriteSnapshot(ctx context.Context, table, runID string, snapshot []byte) (string, error) {
	if err := s.store.EnsureBucket(ctx, s.bucket); err != nil {
		return "", err
	}
	key := s.path(table, fmt.Sprintf("%s.snapshot.json", runID))
	if err := s.store.PutObject(ctx, s.bucket, key, snapshot); err != nil {
		return "", err
	}
	return fmt.Sprintf("minio://%s/%s", s.bucket, key), nil
}

func (s *MinioStore) path(table, file string) string {
	return strings.Trim(strings.Join([]string{s.basePrefix, table, file}, "/"), "/")
}

// Prune deletes run-level logs older than retentionDays (if >0).
func (s *MinioStore) Prune(ctx context.Context, table string, retentionDays int) error {
	if retentionDays <= 0 {
		return nil
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	prefix := strings.Trim(strings.Join([]string{s.basePrefix, table}, "/"), "/")
	keys, err := s.store.ListPrefix(ctx, s.bucket, prefix)
	if err != nil {
		return err
	}
	for _, k := range keys {
		parts := strings.Split(k, "/")
		if len(parts) < 3 {
			continue
		}
		// expect .../<table>/<runId>-<ts>.jsonl or <runId>.snapshot.json
		if strings.HasSuffix(k, ".jsonl") || strings.HasSuffix(k, ".snapshot.json") {
			// crude parse: look for nanosecond suffix in filename
			base := filepath.Base(k)
			tsStr := strings.TrimSuffix(base, ".jsonl")
			tsStr = strings.TrimSuffix(tsStr, ".snapshot.json")
			fields := strings.Split(tsStr, "-")
			if len(fields) >= 2 {
				if ns, err := strconv.ParseInt(fields[len(fields)-1], 10, 64); err == nil {
					if time.Unix(0, ns).Before(cutoff) {
						_ = s.store.DeleteObject(ctx, s.bucket, k)
					}
				}
			}
		}
	}
	return nil
}

// ListPaths returns object keys under the given prefix (relative to basePrefix).
func (s *MinioStore) ListPaths(ctx context.Context, prefix string) ([]string, error) {
	p := strings.Trim(prefix, "/")
	return s.store.ListPrefix(ctx, s.bucket, p)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}
