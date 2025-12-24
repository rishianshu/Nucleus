package orchestration

import (
	"log"
	"os"
	"sync"

	minioProvider "github.com/nucleus/ucl-core/internal/connector/minio"
	"github.com/nucleus/ucl-core/pkg/staging"
)

var (
	defaultStagingRegistry     *staging.Registry
	defaultStagingRegistryOnce sync.Once
)

// DefaultStagingRegistry returns the shared staging registry (memory, object-store, minio).
func DefaultStagingRegistry() *staging.Registry {
	defaultStagingRegistryOnce.Do(func() {
		defaultStagingRegistry = BuildStagingRegistry()
	})
	return defaultStagingRegistry
}

// BuildStagingRegistry constructs the staging registry with all available providers.
// Registration order: memory -> object-store -> minio (minio is preferred for large payloads)
func BuildStagingRegistry() *staging.Registry {
	reg := staging.NewRegistry()

	// Always register memory provider for small payloads
	reg.Register(staging.NewMemoryProvider(staging.DefaultMemoryCapBytes))
	log.Printf("[staging-registry] Registered memory provider")

	// Always register object-store for larger local dev scenarios
	reg.Register(staging.NewObjectStoreProvider(""))
	log.Printf("[staging-registry] Registered object-store provider")

	// Try to register MinIO if configured
	endpointURL := os.Getenv("MINIO_ENDPOINT")
	log.Printf("[staging-registry] MINIO_ENDPOINT=%q", endpointURL)

	if endpointURL != "" {
		p, err := NewMinioStagingProviderFromEnv()
		if err != nil {
			log.Printf("[staging-registry] Failed to create MinIO provider: %v", err)
		} else if p != nil {
			reg.Register(p)
			log.Printf("[staging-registry] Registered MinIO provider (object.minio)")
		}
	} else {
		log.Printf("[staging-registry] No MINIO_ENDPOINT configured, skipping MinIO registration")
	}

	log.Printf("[staging-registry] Final providers: %v", reg.ProviderIDs())
	return reg
}

// NewMinioStagingProviderFromEnv builds a MinIO staging provider from environment.
func NewMinioStagingProviderFromEnv() (staging.Provider, error) {
	endpointURL := os.Getenv("MINIO_ENDPOINT")
	if endpointURL == "" {
		return nil, nil
	}

	bucket := os.Getenv("MINIO_BUCKET")
	if bucket == "" {
		bucket = "ucl-staging"
	}

	cfg := minioProvider.ParseConfig(map[string]any{
		"endpointUrl":     endpointURL,
		"accessKeyId":     os.Getenv("MINIO_ACCESS_KEY"),
		"secretAccessKey": os.Getenv("MINIO_SECRET_KEY"),
		"bucket":          bucket,
		"basePrefix":      os.Getenv("MINIO_STAGE_PREFIX"),
		"tenantId":        os.Getenv("TENANT_ID"),
	})

	provider, err := minioProvider.NewStagingProvider(cfg, nil)
	if err != nil {
		return nil, err
	}
	return provider, nil
}
