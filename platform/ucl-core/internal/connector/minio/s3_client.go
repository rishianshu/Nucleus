package minio

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3Client implements ObjectStore using the minio-go SDK for real MinIO/S3 connectivity.
type S3Client struct {
	client *minio.Client
	cfg    *Config
}

// NewS3Client creates a real MinIO/S3 client from config.
func NewS3Client(cfg *Config) (*S3Client, error) {
	if cfg == nil {
		return nil, wrapError(CodeEndpointUnreachable, true, fmt.Errorf("config is required"))
	}
	if cfg.EndpointURL == "" {
		return nil, wrapError(CodeEndpointUnreachable, true, fmt.Errorf("endpointUrl is required"))
	}
	if cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, wrapError(CodeAuthInvalid, false, fmt.Errorf("credentials are required"))
	}

	// Parse endpoint URL to extract host
	u, err := url.Parse(cfg.EndpointURL)
	if err != nil {
		return nil, wrapError(CodeEndpointUnreachable, true, fmt.Errorf("invalid endpoint URL: %w", err))
	}
	endpoint := u.Host
	if endpoint == "" {
		endpoint = cfg.EndpointURL
	}

	// Determine SSL from URL scheme or config
	useSSL := cfg.UseSSL
	if u.Scheme == "https" {
		useSSL = true
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: useSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, wrapError(CodeEndpointUnreachable, true, fmt.Errorf("failed to create minio client: %w", err))
	}

	return &S3Client{
		client: client,
		cfg:    cfg,
	}, nil
}

func (s *S3Client) Ping(ctx context.Context) error {
	// List buckets as a health check
	_, err := s.client.ListBuckets(ctx)
	if err != nil {
		return classifyMinioError(err)
	}
	return nil
}

func (s *S3Client) EnsureBucket(ctx context.Context, bucket string) error {
	if bucket == "" {
		return wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket name is required"))
	}

	exists, err := s.client.BucketExists(ctx, bucket)
	if err != nil {
		return classifyMinioError(err)
	}
	if exists {
		return nil
	}

	// Try to create the bucket
	err = s.client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{
		Region: s.cfg.Region,
	})
	if err != nil {
		return classifyMinioError(err)
	}
	return nil
}

func (s *S3Client) BucketExists(ctx context.Context, bucket string) (bool, error) {
	if bucket == "" {
		return false, nil
	}
	exists, err := s.client.BucketExists(ctx, bucket)
	if err != nil {
		return false, classifyMinioError(err)
	}
	return exists, nil
}

func (s *S3Client) PutObject(ctx context.Context, bucket, key string, data []byte) error {
	if bucket == "" {
		return wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket is required"))
	}
	if key == "" {
		return wrapError(CodeStagingWriteFailed, false, fmt.Errorf("object key is required"))
	}

	reader := bytes.NewReader(data)
	_, err := s.client.PutObject(ctx, bucket, key, reader, int64(len(data)), minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	if err != nil {
		return classifyMinioError(err)
	}
	return nil
}

func (s *S3Client) GetObject(ctx context.Context, bucket, key string) ([]byte, error) {
	if bucket == "" {
		return nil, wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket is required"))
	}
	if key == "" {
		return nil, wrapError(CodeObjectNotFound, false, fmt.Errorf("object key is required"))
	}

	obj, err := s.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, classifyMinioError(err)
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		return nil, classifyMinioError(err)
	}
	return data, nil
}

func (s *S3Client) ListPrefix(ctx context.Context, bucket, prefix string) ([]string, error) {
	if bucket == "" {
		return nil, wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket is required"))
	}

	var keys []string
	objectCh := s.client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	for obj := range objectCh {
		if obj.Err != nil {
			return nil, classifyMinioError(obj.Err)
		}
		keys = append(keys, obj.Key)
	}
	return keys, nil
}

func (s *S3Client) DeleteObject(ctx context.Context, bucket, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if bucket == "" || key == "" {
		return wrapError(CodeBucketNotFound, false, fmt.Errorf("bucket/key is required"))
	}
	return s.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}

// classifyMinioError converts minio-go errors to our structured Error type.
func classifyMinioError(err error) *Error {
	if err == nil {
		return nil
	}

	errStr := strings.ToLower(err.Error())

	// Check for specific minio error responses
	if minioErr, ok := err.(minio.ErrorResponse); ok {
		switch minioErr.Code {
		case "NoSuchBucket":
			return wrapError(CodeBucketNotFound, false, err)
		case "NoSuchKey":
			return wrapError(CodeObjectNotFound, false, err)
		case "AccessDenied":
			return wrapError(CodePermissionDenied, false, err)
		case "InvalidAccessKeyId", "SignatureDoesNotMatch":
			return wrapError(CodeAuthInvalid, false, err)
		}
	}

	// Fallback to string matching
	if strings.Contains(errStr, "no such bucket") {
		return wrapError(CodeBucketNotFound, false, err)
	}
	if strings.Contains(errStr, "no such key") || strings.Contains(errStr, "not found") || strings.Contains(errStr, "does not exist") {
		return wrapError(CodeObjectNotFound, false, err)
	}
	if strings.Contains(errStr, "access denied") || strings.Contains(errStr, "permission") {
		return wrapError(CodePermissionDenied, false, err)
	}
	if strings.Contains(errStr, "invalid access key") || strings.Contains(errStr, "signature") || strings.Contains(errStr, "authentication") {
		return wrapError(CodeAuthInvalid, false, err)
	}
	if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "deadline") {
		return wrapError(CodeTimeout, true, err)
	}
	if strings.Contains(errStr, "connection refused") || strings.Contains(errStr, "unreachable") || strings.Contains(errStr, "no such host") {
		return wrapError(CodeEndpointUnreachable, true, err)
	}

	// Default to retryable staging error
	return wrapError(CodeStagingWriteFailed, true, err)
}
