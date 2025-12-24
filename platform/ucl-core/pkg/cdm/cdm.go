package cdm

import internal "github.com/nucleus/ucl-core/internal/core/cdm"

// Re-export CDM model constants.
const (
	ModelWorkProject = internal.ModelWorkProject
	ModelWorkUser    = internal.ModelWorkUser
	ModelWorkItem    = internal.ModelWorkItem
	ModelWorkComment = internal.ModelWorkComment
	ModelWorkLog     = internal.ModelWorkLog

	ModelDocSpace    = internal.ModelDocSpace
	ModelDocItem     = internal.ModelDocItem
	ModelDocRevision = internal.ModelDocRevision
	ModelDocLink     = internal.ModelDocLink
)

// ColumnDef exposes CDM column metadata.
type ColumnDef = internal.ColumnDef

// ColumnDDLs returns DDL fragments for the given model ID, or nil if unknown.
func ColumnDDLs(modelID string) []string {
	return internal.ColumnDDLs(modelID)
}

// ModelSchema returns column definitions for a CDM model.
func ModelSchema(modelID string) []ColumnDef {
	return internal.ModelSchema(modelID)
}
