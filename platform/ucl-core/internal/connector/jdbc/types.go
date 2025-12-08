package jdbc

import (
	"fmt"
	"strings"

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
		SSLMode:  getString(m, "sslMode", getString(m, "ssl_mode", "disable")),
	}
	
	// Build connection string or use provided one
	if connStr := getString(m, "connectionString", getString(m, "connection_string", "")); connStr != "" {
		cfg.ConnectionString = connStr
		
		// Ensure sslmode is set in connection string if not present
		if !strings.Contains(strings.ToLower(connStr), "sslmode=") {
			if strings.Contains(connStr, "?") {
				cfg.ConnectionString = connStr + "&sslmode=" + cfg.SSLMode
			} else {
				cfg.ConnectionString = connStr + "?sslmode=" + cfg.SSLMode
			}
		}
	} else {
		// Use single-quoted values to handle special characters in passwords
		cfg.ConnectionString = fmt.Sprintf(
			"host=%s port=%d user='%s' password='%s' dbname='%s' sslmode=%s",
			cfg.Host, cfg.Port, escapeConnValue(cfg.User), escapeConnValue(cfg.Password), escapeConnValue(cfg.Database), cfg.SSLMode,
		)
	}
	
	return cfg
}

// GetDescriptor returns JDBC endpoint descriptor with sslMode field.
func GetDescriptor(id, vendor string) *endpoint.Descriptor {
	return &endpoint.Descriptor{
		ID:          id,
		Family:      "jdbc",
		Title:       vendor + " Database",
		Vendor:      vendor,
		Description: vendor + " JDBC connector with SSL support",
		Fields: []*endpoint.FieldDescriptor{
			{Key: "host", Label: "Host", ValueType: "string", Required: true, Semantic: "HOST"},
			{Key: "port", Label: "Port", ValueType: "number", Required: true},
			{Key: "database", Label: "Database", ValueType: "string", Required: true},
			{Key: "user", Label: "Username", ValueType: "string", Required: true},
			{Key: "password", Label: "Password", ValueType: "password", Required: true, Sensitive: true},
			{Key: "sslMode", Label: "SSL Mode", ValueType: "string", Required: false, Description: "SSL mode: disable, require, verify-ca, verify-full (default: disable)"},
			{Key: "connectionString", Label: "Connection String", ValueType: "string", Description: "Full connection string (overrides individual fields)"},
		},
	}
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

// escapeConnValue escapes single quotes in connection string values.
// PostgreSQL DSN uses single quotes, and embedded quotes are escaped by doubling.
func escapeConnValue(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}
