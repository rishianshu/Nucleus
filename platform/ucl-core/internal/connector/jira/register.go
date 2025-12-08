package jira

import (
	"github.com/nucleus/ucl-core/internal/core/cdm"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// init registers Jira factory and CDM mappings with global registries.
func init() {
	// Register Jira endpoint factory
	endpoint.DefaultRegistry().Register("http.jira", func(config map[string]any) (endpoint.Endpoint, error) {
		cfg := &Config{
			BaseURL:   getString(config, "baseUrl", ""),
			Email:     getString(config, "email", ""),
			APIToken:  getString(config, "apiToken", ""),
			FetchSize: getInt(config, "fetchSize", DefaultFetchSize),
		}
		if projects, ok := config["projects"].([]string); ok {
			cfg.Projects = projects
		}
		if jql, ok := config["jql"].(string); ok {
			cfg.JQL = jql
		}
		return New(cfg)
	})

	// Register CDM mappings for Jira endpoint
	endpoint.RegisterCDM("http.jira", []endpoint.CDMMapping{
		{DatasetID: "jira.projects", CdmModelID: cdm.ModelWorkProject, Domains: []string{"entity.work.project"}},
		{DatasetID: "jira.users", CdmModelID: cdm.ModelWorkUser, Domains: []string{"entity.work.user"}},
		{DatasetID: "jira.issues", CdmModelID: cdm.ModelWorkItem, Domains: []string{"entity.work.item"}},
		{DatasetID: "jira.comments", CdmModelID: cdm.ModelWorkComment, Domains: []string{"entity.work.comment"}},
		{DatasetID: "jira.worklogs", CdmModelID: cdm.ModelWorkLog, Domains: []string{"entity.work.worklog"}},
	})

	// Register mapper functions for each dataset
	mapper := NewCDMMapper()
	
	endpoint.RegisterCDMMapper("jira.projects", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("jira.projects", record), nil
	})
	endpoint.RegisterCDMMapper("jira.users", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("jira.users", record), nil
	})
	endpoint.RegisterCDMMapper("jira.issues", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("jira.issues", record), nil
	})
	endpoint.RegisterCDMMapper("jira.comments", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("jira.comments", record), nil
	})
	endpoint.RegisterCDMMapper("jira.worklogs", func(record endpoint.Record) (any, error) {
		return mapper.MapRecord("jira.worklogs", record), nil
	})
}

// --- Config Helpers ---

func getString(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}

func getInt(m map[string]any, key string, defaultVal int) int {
	switch v := m[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return defaultVal
}
