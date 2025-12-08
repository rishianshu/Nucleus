package onedrive

import "github.com/nucleus/ucl-core/internal/endpoint"

// DatasetDefinitions defines available OneDrive datasets.
var DatasetDefinitions = []*endpoint.Dataset{
	{
		ID:   "onedrive.file",
		Name: "OneDrive Files",
		Kind: "entity",
	},
	{
		ID:   "onedrive.folder",
		Name: "OneDrive Folders",
		Kind: "entity",
	},
}

// FileSchema returns the schema for onedrive.file dataset.
var FileSchema = &endpoint.Schema{
	Fields: []*endpoint.FieldDefinition{
		{Name: "id", DataType: "STRING", Nullable: false},
		{Name: "name", DataType: "STRING", Nullable: false},
		{Name: "path", DataType: "STRING", Nullable: false},
		{Name: "size", DataType: "INT64", Nullable: false},
		{Name: "mimeType", DataType: "STRING", Nullable: true},
		{Name: "createdTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "modifiedTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "webUrl", DataType: "STRING", Nullable: true},
		{Name: "createdBy", DataType: "STRING", Nullable: true},
		{Name: "modifiedBy", DataType: "STRING", Nullable: true},
	},
}

// FolderSchema returns the schema for onedrive.folder dataset.
var FolderSchema = &endpoint.Schema{
	Fields: []*endpoint.FieldDefinition{
		{Name: "id", DataType: "STRING", Nullable: false},
		{Name: "name", DataType: "STRING", Nullable: false},
		{Name: "path", DataType: "STRING", Nullable: false},
		{Name: "childCount", DataType: "INT32", Nullable: true},
		{Name: "createdTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "modifiedTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "webUrl", DataType: "STRING", Nullable: true},
	},
}

// GetDatasetByID returns a dataset definition by ID.
func GetDatasetByID(id string) *endpoint.Dataset {
	for _, ds := range DatasetDefinitions {
		if ds.ID == id {
			return ds
		}
	}
	return nil
}

// GetSchemaByDatasetID returns the schema for a dataset.
func GetSchemaByDatasetID(id string) *endpoint.Schema {
	switch id {
	case "onedrive.file":
		return FileSchema
	case "onedrive.folder":
		return FolderSchema
	default:
		return nil
	}
}
