package github

import (
	"strconv"
	"strings"
)

const (
	defaultBaseURL      = "https://api.github.com"
	defaultMaxFileBytes = 1_000_000
	defaultChunkBytes   = 8000
	defaultOverlapBytes = 400
)

// Config holds GitHub connector configuration.
type Config struct {
	Token             string
	BaseURL           string
	Owners            []string
	Repos             []string
	Branch            string
	PathPrefixes      []string
	FileExtensions    []string
	MaxFileBytes      int
	ChunkBytes        int
	OverlapBytes      int
	TenantID          string
	Delegated         bool
	AllowPreviewPaths bool
}

// ParseConfig constructs Config from a generic map.
func ParseConfig(input map[string]any) (*Config, error) {
	cfg := &Config{
		Token:          getString(input, "token", getString(input, "access_token", "")),
		BaseURL:        getString(input, "baseUrl", getString(input, "base_url", defaultBaseURL)),
		Owners:         getStringSlice(input, "owners", "owner"),
		Repos:          getStringSlice(input, "repos", "repositories"),
		Branch:         getString(input, "branch", ""),
		PathPrefixes:   getStringSlice(input, "pathPrefixes", "path_prefixes", "paths"),
		FileExtensions: getStringSlice(input, "fileExtensionsInclude", "file_extensions_include", "extensions"),
		MaxFileBytes:   getInt(input, defaultMaxFileBytes, "maxFileBytes", "max_file_bytes"),
		ChunkBytes:     getInt(input, defaultChunkBytes, "chunkBytes", "chunk_bytes"),
		OverlapBytes:   getInt(input, defaultOverlapBytes, "overlapBytes", "overlap_bytes"),
		TenantID:       getString(input, "tenantId", getString(input, "tenant_id", "")),
		Delegated:      getBool(input, false, "delegated_connected", "delegatedConnected"),
	}

	// Note: token is optional for public repos but strongly recommended to avoid 60 req/hr rate limit
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL
	}
	if cfg.MaxFileBytes <= 0 {
		cfg.MaxFileBytes = defaultMaxFileBytes
	}
	if cfg.ChunkBytes <= 0 {
		cfg.ChunkBytes = defaultChunkBytes
	}
	if cfg.OverlapBytes < 0 {
		cfg.OverlapBytes = defaultOverlapBytes
	}
	if cfg.TenantID == "" {
		cfg.TenantID = "tenant-github"
	}

	return cfg, nil
}

func getString(input map[string]any, key string, fallback ...string) string {
	if v, ok := input[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	for _, alt := range fallback {
		if alt != "" {
			return alt
		}
	}
	return ""
}

func getInt(input map[string]any, def int, keys ...string) int {
	for _, key := range keys {
		if v, ok := input[key]; ok {
			switch val := v.(type) {
			case int:
				return val
			case int64:
				return int(val)
			case float64:
				return int(val)
			case string:
				if parsed, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
					return parsed
				}
			}
		}
	}
	return def
}

func getBool(input map[string]any, def bool, keys ...string) bool {
	for _, key := range keys {
		if v, ok := input[key]; ok {
			switch val := v.(type) {
			case bool:
				return val
			case string:
				lower := strings.ToLower(strings.TrimSpace(val))
				if lower == "true" || lower == "1" || lower == "yes" {
					return true
				}
				if lower == "false" || lower == "0" || lower == "no" {
					return false
				}
			}
		}
	}
	return def
}

func getStringSlice(input map[string]any, keys ...string) []string {
	for _, key := range keys {
		if v, ok := input[key]; ok {
			switch val := v.(type) {
			case []string:
				return normalizeSlice(val)
			case []any:
				out := make([]string, 0, len(val))
				for _, item := range val {
					if s, ok := item.(string); ok {
						out = append(out, s)
					}
				}
				return normalizeSlice(out)
			case string:
				if strings.TrimSpace(val) == "" {
					continue
				}
				parts := strings.Split(val, ",")
				return normalizeSlice(parts)
			}
		}
	}
	return nil
}

func normalizeSlice(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{})
	for _, raw := range in {
		if trimmed := strings.TrimSpace(raw); trimmed != "" {
			lowered := strings.ToLower(trimmed)
			if _, ok := seen[lowered]; ok {
				continue
			}
			seen[lowered] = struct{}{}
			out = append(out, lowered)
		}
	}
	return out
}
