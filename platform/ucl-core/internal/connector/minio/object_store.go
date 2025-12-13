package minio

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ObjectStore abstracts the minimal MinIO/S3 operations needed for staging/sink flows.
type ObjectStore interface {
	Ping(ctx context.Context) error
	EnsureBucket(ctx context.Context, bucket string) error
	BucketExists(ctx context.Context, bucket string) (bool, error)
	PutObject(ctx context.Context, bucket, key string, data []byte) error
	GetObject(ctx context.Context, bucket, key string) ([]byte, error)
	ListPrefix(ctx context.Context, bucket, prefix string) ([]string, error)
}

// LocalStore persists objects on disk to mimic MinIO behaviour for tests.
type LocalStore struct {
	root string
}

// NewLocalStore creates a new local object store rooted at dir.
func NewLocalStore(root string) *LocalStore {
	if root == "" {
		root = filepath.Join(os.TempDir(), "minio-store")
	}
	_ = os.MkdirAll(root, 0o755)
	return &LocalStore{root: root}
}

func (s *LocalStore) Ping(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.MkdirAll(s.root, 0o755)
}

func (s *LocalStore) EnsureBucket(ctx context.Context, bucket string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if bucket == "" {
		return wrapError(CodeBucketNotFound, false, os.ErrNotExist)
	}
	return os.MkdirAll(s.bucketPath(bucket), 0o755)
}

func (s *LocalStore) BucketExists(ctx context.Context, bucket string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	info, err := os.Stat(s.bucketPath(bucket))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return info.IsDir(), nil
}

func (s *LocalStore) PutObject(ctx context.Context, bucket, key string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if bucket == "" {
		return wrapError(CodeBucketNotFound, false, os.ErrNotExist)
	}
	if err := s.EnsureBucket(ctx, bucket); err != nil {
		return err
	}

	fullPath := filepath.Join(s.bucketPath(bucket), filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return wrapError(CodePermissionDenied, false, err)
	}
	if err := os.WriteFile(fullPath, data, 0o644); err != nil {
		return wrapError(CodeStagingWriteFailed, true, err)
	}
	return nil
}

func (s *LocalStore) GetObject(ctx context.Context, bucket, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if bucket == "" {
		return nil, wrapError(CodeBucketNotFound, false, os.ErrNotExist)
	}
	fullPath := filepath.Join(s.bucketPath(bucket), filepath.FromSlash(key))
	data, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, wrapError(CodeObjectNotFound, false, err)
		}
		return nil, wrapError(CodeStagingWriteFailed, true, err)
	}
	return data, nil
}

func (s *LocalStore) ListPrefix(ctx context.Context, bucket, prefix string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if bucket == "" {
		return nil, wrapError(CodeBucketNotFound, false, os.ErrNotExist)
	}
	root := filepath.Join(s.bucketPath(bucket), filepath.FromSlash(prefix))

	var keys []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(s.bucketPath(bucket), path)
		if relErr != nil {
			return relErr
		}
		keys = append(keys, filepath.ToSlash(rel))
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, wrapError(CodeSinkWriteFailed, true, err)
	}
	sort.Strings(keys)
	return keys, nil
}

func (s *LocalStore) bucketPath(bucket string) string {
	return filepath.Join(s.root, sanitizePath(bucket))
}

func joinPath(parts ...string) string {
	joined := filepath.ToSlash(filepath.Join(parts...))
	return strings.TrimPrefix(joined, "/")
}
