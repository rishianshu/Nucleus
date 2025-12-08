package jdbc

import (
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Config holds JDBC connection configuration.
type Config struct {
	Driver           string
	Host             string
	Port             int
	Database         string
	User             string
	Password         string
	SSLMode          string
	ConnectionString string
}

// ParseConfig extracts configuration from a map.
func ParseConfig(m map[string]interface{}) *Config {
	cfg := &Config{
		Driver:   getString(m, "driver", "postgres"),
		Host:     getString(m, "host", "localhost"),
		Port:     getInt(m, "port", 5432),
		Database: getString(m, "database", ""),
		User:     getString(m, "user", ""),
		Password: getString(m, "password", ""),
		SSLMode:  getString(m, "ssl_mode", "disable"),
	}
	
	// Build connection string if not provided
	if connStr := getString(m, "connection_string", ""); connStr != "" {
		cfg.ConnectionString = connStr
	} else {
		cfg.ConnectionString = fmt.Sprintf(
			"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
			cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Database, cfg.SSLMode,
		)
	}
	
	return cfg
}

// =============================================================================
// TYPE ALIASES - Use endpoint package types
// JDBC uses the same types as endpoint, no local duplicates.
// =============================================================================

// ValidationResult is an alias for endpoint.ValidationResult.
type ValidationResult = endpoint.ValidationResult

// ValidateResult is a backward-compatible alias.
type ValidateResult = endpoint.ValidationResult

// Capabilities is an alias for endpoint.Capabilities.
type Capabilities = endpoint.Capabilities

// Dataset is an alias for endpoint.Dataset.
type Dataset = endpoint.Dataset

// DatasetItem is a backward-compatible alias for Dataset.
type DatasetItem = endpoint.Dataset

// IngestionSlice is an alias for endpoint.IngestionSlice.
type IngestionSlice = endpoint.IngestionSlice

// IngestionPlan is an alias for endpoint.IngestionPlan.
type IngestionPlan = endpoint.IngestionPlan

// Checkpoint is an alias for endpoint.Checkpoint.
type Checkpoint = endpoint.Checkpoint

// FieldDefinition is an alias for endpoint.FieldDefinition.
type FieldDefinition = endpoint.FieldDefinition

// Constraint is an alias for endpoint.Constraint.
type Constraint = endpoint.Constraint

// DatasetStatistics is an alias for endpoint.DatasetStatistics.
type DatasetStatistics = endpoint.DatasetStatistics

// Schema is an alias for endpoint.Schema.
type Schema = endpoint.Schema

// SchemaResult is a backward-compatible alias for Schema.
type SchemaResult = endpoint.Schema

// --- Helper functions ---

func getString(m map[string]interface{}, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}

func getInt(m map[string]interface{}, key string, defaultVal int) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	if v, ok := m[key].(int); ok {
		return v
	}
	return defaultVal
}
