package confluence

import (
	"github.com/nucleus/ucl-core/internal/core/cdm"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// init registers Confluence factory and CDM mappings with global registries.
func init() {
	// Register Confluence endpoint factory
	endpoint.DefaultRegistry().Register("http.confluence", func(config map[string]any) (endpoint.Endpoint, error) {
		cfg := &Config{
			BaseURL:   getStringConfig(config, "baseUrl", ""),
			Email:     getStringConfig(config, "email", ""),
			APIToken:  getStringConfig(config, "apiToken", ""),
			FetchSize: getIntConfig(config, "fetchSize", DefaultFetchSize),
		}
		if spaces, ok := config["spaces"].([]string); ok {
			cfg.Spaces = spaces
		}
		return New(cfg)
	})

	// Register CDM mappings for Confluence endpoint
	endpoint.RegisterCDM("http.confluence", []endpoint.CDMMapping{
		{DatasetID: "confluence.space", CdmModelID: cdm.ModelDocSpace, Domains: []string{"entity.doc.space"}},
		{DatasetID: "confluence.page", CdmModelID: cdm.ModelDocItem, Domains: []string{"entity.doc.item"}},
		{DatasetID: "confluence.attachment", CdmModelID: cdm.ModelDocLink, Domains: []string{"entity.doc.link"}},
		{DatasetID: "confluence.acl", CdmModelID: "cdm.doc.access", Domains: []string{"entity.doc.access"}},
	})

	// Register mapper functions for each dataset
	mapper := NewCDMMapper()

	endpoint.RegisterCDMMapper("confluence.space", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("confluence.space", record), nil
	})
	endpoint.RegisterCDMMapper("confluence.page", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("confluence.page", record), nil
	})
	endpoint.RegisterCDMMapper("confluence.attachment", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("confluence.attachment", record), nil
	})
}

// --- Config Helpers ---

func getStringConfig(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}

func getIntConfig(m map[string]any, key string, defaultVal int) int {
	switch v := m[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return defaultVal
}
