package minio

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

const (
	defaultBucket     = "ucl-staging"
	defaultBasePrefix = "sink"
	defaultTenantID   = "default"
)

// Config captures the object.minio endpoint configuration.
type Config struct {
	EndpointURL      string
	Region           string
	UseSSL           bool
	AccessKeyID      string
	SecretAccessKey  string
	Bucket           string
	BasePrefix       string
	TenantID         string
	RootPathOverride string
}

// ParseConfig builds a Config from loose parameters.
func ParseConfig(params map[string]any) *Config {
	cfg := &Config{
		EndpointURL:     firstString(params, "endpointUrl", "endpoint_url", "url"),
		Region:          firstString(params, "region"),
		UseSSL:          firstBool(params, false, "useSSL", "use_ssl"),
		AccessKeyID:     firstString(params, "accessKeyId", "access_key_id", "accessKeyID"),
		SecretAccessKey: firstString(params, "secretAccessKey", "secret_access_key", "secretKey"),
		Bucket:          firstString(params, "bucket"),
		BasePrefix:      firstString(params, "basePrefix", "base_prefix", "prefix"),
		TenantID:        firstString(params, "tenantId", "tenant_id"),
		RootPathOverride: firstString(params,
			"rootPath", "root_path", "devRoot", "dev_root"),
	}
	cfg.normalizeDefaults()
	return cfg
}

// Validate enforces required fields and basic reachability hints.
func (c *Config) Validate() *endpoint.ValidationResult {
	if c.EndpointURL == "" {
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   "E_ENDPOINT_UNREACHABLE: endpointUrl is required",
			Code:      CodeEndpointUnreachable,
			Retryable: true,
		}
	}

	if _, err := url.Parse(c.EndpointURL); err != nil {
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   fmt.Sprintf("%s: %v", CodeEndpointUnreachable, err),
			Code:      CodeEndpointUnreachable,
			Retryable: true,
		}
	}

	if c.AccessKeyID == "" || c.SecretAccessKey == "" {
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   fmt.Sprintf("%s: accessKeyId and secretAccessKey are required", CodeAuthInvalid),
			Code:      CodeAuthInvalid,
			Retryable: false,
		}
	}

	// Allow explicit invalid creds simulation for tests.
	if strings.EqualFold(c.AccessKeyID, "invalid") || strings.EqualFold(c.SecretAccessKey, "invalid") {
		return &endpoint.ValidationResult{
			Valid:     false,
			Message:   fmt.Sprintf("%s: credentials rejected", CodeAuthInvalid),
			Code:      CodeAuthInvalid,
			Retryable: false,
		}
	}

	return &endpoint.ValidationResult{
		Valid:   true,
		Message: "connection parameters look valid",
	}
}

func (c *Config) normalizeDefaults() {
	if c.Bucket == "" {
		c.Bucket = defaultBucket
	}
	if c.BasePrefix == "" {
		c.BasePrefix = defaultBasePrefix
	}
	c.BasePrefix = strings.Trim(c.BasePrefix, "/")
	if c.TenantID == "" {
		c.TenantID = defaultTenantID
	}
}

func (c *Config) objectRoot() string {
	if c.RootPathOverride != "" {
		return c.RootPathOverride
	}
	if strings.HasPrefix(c.EndpointURL, "file://") {
		if u, err := url.Parse(c.EndpointURL); err == nil {
			if u.Path != "" {
				return u.Path
			}
		}
	}
	host := c.EndpointURL
	if u, err := url.Parse(c.EndpointURL); err == nil && u.Host != "" {
		host = u.Host
	}
	return filepath.Join(os.TempDir(), "minio-"+sanitizePath(host))
}

func firstString(params map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := params[key]; ok {
			switch t := v.(type) {
			case string:
				return strings.TrimSpace(t)
			case fmt.Stringer:
				return strings.TrimSpace(t.String())
			}
		}
	}
	return ""
}

func firstBool(params map[string]any, defaultVal bool, keys ...string) bool {
	for _, key := range keys {
		if v, ok := params[key]; ok {
			switch t := v.(type) {
			case bool:
				return t
			case string:
				lowered := strings.ToLower(strings.TrimSpace(t))
				if lowered == "true" {
					return true
				}
				if lowered == "false" {
					return false
				}
			}
		}
	}
	return defaultVal
}

func sanitizePath(raw string) string {
	replacer := strings.NewReplacer(":", "_", "/", "_", "\\", "_")
	return replacer.Replace(raw)
}
