package cdm

import (
	"fmt"
	"strings"
)

// ColumnDef captures a CDM column definition for sink provisioning.
type ColumnDef struct {
	Name     string
	Type     string
	Nullable bool
}

// modelSchemas maps CDM model IDs to column definitions.
var modelSchemas = map[string][]ColumnDef{
	ModelWorkProject: {
		{Name: "id", Type: "TEXT"},
		{Name: "source_system", Type: "TEXT", Nullable: true},
		{Name: "source_project_key", Type: "TEXT", Nullable: true},
		{Name: "name", Type: "TEXT", Nullable: true},
		{Name: "description", Type: "TEXT", Nullable: true},
		{Name: "url", Type: "TEXT", Nullable: true},
		{Name: "properties", Type: "JSONB", Nullable: true},
	},
	ModelWorkUser: {
		{Name: "id", Type: "TEXT"},
		{Name: "source_system", Type: "TEXT", Nullable: true},
		{Name: "source_user_id", Type: "TEXT", Nullable: true},
		{Name: "display_name", Type: "TEXT", Nullable: true},
		{Name: "email", Type: "TEXT", Nullable: true},
		{Name: "active", Type: "BOOLEAN", Nullable: true},
		{Name: "properties", Type: "JSONB", Nullable: true},
	},
	ModelWorkItem: {
		{Name: "id", Type: "TEXT"},
		{Name: "source_system", Type: "TEXT", Nullable: true},
		{Name: "source_id", Type: "TEXT", Nullable: true},
		{Name: "source_issue_key", Type: "TEXT", Nullable: true},
		{Name: "project_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "reporter_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "assignee_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "issue_type", Type: "TEXT", Nullable: true},
		{Name: "status", Type: "TEXT", Nullable: true},
		{Name: "status_category", Type: "TEXT", Nullable: true},
		{Name: "priority", Type: "TEXT", Nullable: true},
		{Name: "summary", Type: "TEXT", Nullable: true},
		{Name: "description", Type: "TEXT", Nullable: true},
		{Name: "labels", Type: "JSONB", Nullable: true},
		{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "closed_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "properties", Type: "JSONB", Nullable: true},
	},
	ModelWorkComment: {
		{Name: "id", Type: "TEXT"},
		{Name: "source_system", Type: "TEXT", Nullable: true},
		{Name: "source_comment_id", Type: "TEXT", Nullable: true},
		{Name: "item_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "author_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "body", Type: "TEXT", Nullable: true},
		{Name: "created_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "updated_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "visibility", Type: "TEXT", Nullable: true},
		{Name: "properties", Type: "JSONB", Nullable: true},
	},
	ModelWorkLog: {
		{Name: "id", Type: "TEXT"},
		{Name: "source_system", Type: "TEXT", Nullable: true},
		{Name: "source_worklog_id", Type: "TEXT", Nullable: true},
		{Name: "item_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "author_cdm_id", Type: "TEXT", Nullable: true},
		{Name: "started_at", Type: "TIMESTAMPTZ", Nullable: true},
		{Name: "time_spent_seconds", Type: "INTEGER", Nullable: true},
		{Name: "comment", Type: "TEXT", Nullable: true},
		{Name: "visibility", Type: "TEXT", Nullable: true},
		{Name: "properties", Type: "JSONB", Nullable: true},
	},
}

// ColumnDDLs returns DDL fragments for the given model ID, or nil if unknown.
func ColumnDDLs(modelID string) []string {
	schema, ok := modelSchemas[strings.ToLower(modelID)]
	if !ok {
		return nil
	}
	out := make([]string, 0, len(schema))
	for _, col := range schema {
		ddl := fmt.Sprintf("%s %s", col.Name, col.Type)
		if !col.Nullable {
			ddl += " NOT NULL"
		}
		out = append(out, ddl)
	}
	return out
}

// ModelSchema returns a copy of the column definitions for a CDM model.
func ModelSchema(modelID string) []ColumnDef {
	schema, ok := modelSchemas[strings.ToLower(modelID)]
	if !ok || len(schema) == 0 {
		return nil
	}
	out := make([]ColumnDef, len(schema))
	copy(out, schema)
	return out
}
