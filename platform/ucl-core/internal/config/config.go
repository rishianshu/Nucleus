// Package config provides configuration loading for UCL services.
package config

import (
	"os"
	"strconv"
)

// GatewayConfig holds gateway server configuration.
type GatewayConfig struct {
	// Server settings
	Port int
	Host string

	// Connection pool settings
	MaxIdleConns    int
	IdleTimeoutSecs int

	// Temporal settings
	TemporalHost      string
	TemporalNamespace string
	TemporalTaskQueue string
}

// LoadGatewayConfig loads configuration from environment.
func LoadGatewayConfig() *GatewayConfig {
	return &GatewayConfig{
		Port:              getEnvInt("UCL_GATEWAY_PORT", 50051),
		Host:              getEnv("UCL_GATEWAY_HOST", "0.0.0.0"),
		MaxIdleConns:      getEnvInt("UCL_MAX_IDLE_CONNS", 10),
		IdleTimeoutSecs:   getEnvInt("UCL_IDLE_TIMEOUT_SECS", 300),
		TemporalHost:      getEnv("UCL_TEMPORAL_HOST", "localhost:7233"),
		TemporalNamespace: getEnv("UCL_TEMPORAL_NAMESPACE", "ucl-dev"),
		TemporalTaskQueue: getEnv("UCL_TEMPORAL_TASK_QUEUE", "ucl-workers"),
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}
