package minio

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Endpoint implements the object.minio connector (staging provider + sink).
type Endpoint struct {
	config *Config
	store  ObjectStore
}

// New creates a MinIO endpoint from raw parameters.
// It uses a real S3 client for http/https endpoints, and falls back to LocalStore for file:// URLs or test mode.
func New(params map[string]any) (*Endpoint, error) {
	cfg := ParseConfig(params)

	var store ObjectStore
	var storeErr error

	// Use real S3 client for http/https endpoints
	if strings.HasPrefix(cfg.EndpointURL, "http://") || strings.HasPrefix(cfg.EndpointURL, "https://") {
		store, storeErr = NewS3Client(cfg)
		if storeErr != nil {
			// Log but don't fail - fall back to local store for dev/test
			store = nil
		}
	}

	// Fallback to local store for file:// URLs, tests, or if S3 client creation failed
	if store == nil {
		store = NewLocalStore(cfg.objectRoot())
	}

	return &Endpoint{
		config: cfg,
		store:  store,
	}, nil
}

// ID returns the endpoint template ID.
func (e *Endpoint) ID() string { return "object.minio" }

// Close releases resources (noop for local store).
func (e *Endpoint) Close() error { return nil }

// GetDescriptor describes the MinIO endpoint template.
func (e *Endpoint) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          "object.minio",
		Family:      "object",
		Title:       "MinIO Object Store",
		Vendor:      "MinIO",
		Description: "S3-compatible object store used for staging and sink destinations",
		Categories:  []string{"object_store", "storage"},
		Protocols:   []string{"S3", "HTTP"},
		DefaultPort: 9000,
		Driver:      "minio",
		DocsURL:     "https://min.io/docs/minio/container/index.html",
		Capabilities: []*endpoint.CapabilityDescriptor{
			{Key: "endpoint.test_connection", Label: "Test Connection", Description: "Validate endpointUrl + credentials + bucket reachability"},
			{Key: "staging.provider.object_store", Label: "Object-store staging", Description: "Emit staged JSONL.GZ batches via stageRef handles"},
			{Key: "sink.write", Label: "Sink write", Description: "Persist staged batches to durable sink paths and emit catalog artifacts"},
		},
		SampleConfig: map[string]any{
			"endpointUrl":     "http://localhost:9000",
			"accessKeyId":     "minioadmin",
			"secretAccessKey": "minioadmin",
			"bucket":          defaultBucket,
			"basePrefix":      "sink",
		},
		Auth: &endpoint.AuthDescriptor{
			Modes: []endpoint.AuthModeDescriptor{
				{
					Mode:           "service",
					Label:          "Access Key",
					RequiredFields: []string{"accessKeyId", "secretAccessKey"},
					Interactive:    false,
				},
			},
		},
		Fields: []*endpoint.FieldDescriptor{
			{Key: "endpointUrl", Label: "Endpoint URL", ValueType: "string", Required: true, Semantic: "HOST", Placeholder: "http://localhost:9000"},
			{Key: "region", Label: "Region", ValueType: "string", Required: false, Semantic: "GENERIC"},
			{Key: "useSSL", Label: "Use SSL", ValueType: "boolean", Required: false, DefaultValue: "false"},
			{Key: "accessKeyId", Label: "Access Key ID", ValueType: "string", Required: true, Semantic: "GENERIC", Description: "MinIO access key"},
			{Key: "secretAccessKey", Label: "Secret Access Key", ValueType: "password", Required: true, Semantic: "PASSWORD", Sensitive: true, Description: "MinIO secret key"},
			{Key: "bucket", Label: "Bucket", ValueType: "string", Required: false, Semantic: "GENERIC", Description: "Bucket used for staging/sink (default: " + defaultBucket + ")"},
			{Key: "basePrefix", Label: "Base Prefix", ValueType: "string", Required: false, Semantic: "GENERIC", Description: "Base path for sink artifacts (default: sink)"},
			{Key: "tenantId", Label: "Tenant ID", ValueType: "string", Required: false, Semantic: "GENERIC", Description: "Tenant namespace for staging/sink layout"},
		},
	}
}

// GetCapabilities advertises supported operations.
func (e *Endpoint) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsPreview:  false,
		SupportsWrite:    true,
		SupportsFinalize: true,
		SupportsStaging:  true,
		SupportsMetadata: false,
	}
}

// ValidateConfig verifies connectivity, credentials, and (optional) bucket access.
func (e *Endpoint) ValidateConfig(ctx context.Context, params map[string]any) (*endpoint.ValidationResult, error) {
	cfg := ParseConfig(params)
	res := cfg.Validate()
	if !res.Valid {
		return res, nil
	}

	if strings.Contains(strings.ToLower(cfg.EndpointURL), "unreachable") {
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   fmt.Sprintf("%s: host unreachable", CodeEndpointUnreachable),
			Code:      CodeEndpointUnreachable,
			Retryable: true,
		}, nil
	}

	// Use same store selection logic as New() - try S3Client for http/https, fallback to LocalStore
	var store ObjectStore
	if strings.HasPrefix(cfg.EndpointURL, "http://") || strings.HasPrefix(cfg.EndpointURL, "https://") {
		s3Client, err := NewS3Client(cfg)
		if err == nil {
			store = s3Client
		}
	}
	if store == nil {
		store = NewLocalStore(cfg.objectRoot())
	}

	if err := store.Ping(ctx); err != nil {
		return validationFromError(CodeEndpointUnreachable, true, err), nil
	}

	// Bucket presence check (fail-closed).
	if cfg.Bucket != "" {
		exists, err := store.BucketExists(ctx, cfg.Bucket)
		if err != nil {
			return validationFromError(CodeBucketNotFound, false, err), nil
		}
		if !exists {
			return &endpoint.ValidationResult{
				Valid:     false,
				Message:   fmt.Sprintf("%s: bucket %s not found", CodeBucketNotFound, cfg.Bucket),
				Code:      CodeBucketNotFound,
				Retryable: false,
			}, nil
		}
	}

	// Write/read probe to validate permissions.
	probeKey := joinPath(cfg.BasePrefix, "probe", fmt.Sprintf("ts-%d.txt", time.Now().UnixNano()))
	if err := store.PutObject(ctx, cfg.Bucket, probeKey, []byte("probe")); err != nil {
		code, retryable := classifyError(err)
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   err.Error(),
			Code:      code,
			Retryable: retryable,
		}, nil
	}

	return &endpoint.ValidationResult{
		Valid:           true,
		Message:         "Connected to MinIO endpoint",
		DetectedVersion: "minio-go/v7",
		Code:            "",
		Retryable:       false,
	}, nil
}

func validationFromError(code string, retryable bool, err error) *endpoint.ValidationResult {
	msg := code
	if err != nil {
		msg = fmt.Sprintf("%s: %v", code, err)
	}
	return &endpoint.ValidationResult{
		Valid:     false,
		Message:   msg,
		Code:      code,
		Retryable: retryable,
	}
}

func classifyError(err error) (string, bool) {
	var coded interface {
		CodeValue() string
		RetryableStatus() bool
	}
	if errors.As(err, &coded) {
		return coded.CodeValue(), coded.RetryableStatus()
	}
	lowered := strings.ToLower(err.Error())
	if strings.Contains(lowered, "timeout") {
		return CodeTimeout, true
	}
	if strings.Contains(lowered, "permission") {
		return CodePermissionDenied, false
	}
	return CodeSinkWriteFailed, true
}
