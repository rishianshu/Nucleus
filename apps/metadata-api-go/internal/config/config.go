// Package config provides configuration management for the metadata-api service.
package config

import (
	"os"
	"strconv"
)

// Config holds all configuration for the metadata-api service.
type Config struct {
	// Server settings
	Port string

	// Database settings
	DatabaseURL    string
	MigrationsPath string

	// Temporal settings
	TemporalAddress   string
	TemporalNamespace string
	TemporalTaskQueue string

	// Auth settings
	JWKSUrl       string
	AuthIssuer    string
	AuthAudience  string
	AuthDebug     bool

	// Feature flags
	FakeCollections bool

	// Metadata defaults
	DefaultProject          string
	DefaultSinkID           string
	DefaultStagingProvider  string
	DefaultIngestionDriver  string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port: getEnv("METADATA_API_PORT", "4010"),

		DatabaseURL:    getEnv("DATABASE_URL", ""),
		MigrationsPath: getEnv("METADATA_MIGRATIONS_PATH", "./migrations"),

		TemporalAddress:   getEnv("TEMPORAL_ADDRESS", "localhost:7233"),
		TemporalNamespace: getEnv("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue: getEnv("TEMPORAL_TASK_QUEUE", "metadata"),

		JWKSUrl:      getEnv("AUTH_JWKS_URL", ""),
		AuthIssuer:   getEnv("AUTH_ISSUER", ""),
		AuthAudience: getEnv("AUTH_AUDIENCE", ""),
		AuthDebug:    getEnvBool("METADATA_AUTH_DEBUG", false),

		FakeCollections: getEnvBool("METADATA_FAKE_COLLECTIONS", false),

		DefaultProject:         getEnv("METADATA_DEFAULT_PROJECT", "global"),
		DefaultSinkID:          getEnv("INGESTION_DEFAULT_SINK", "kb"),
		DefaultStagingProvider: getEnv("INGESTION_DEFAULT_STAGING_PROVIDER", "in_memory"),
		DefaultIngestionDriver: getEnv("INGESTION_DEFAULT_DRIVER", "static"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}
