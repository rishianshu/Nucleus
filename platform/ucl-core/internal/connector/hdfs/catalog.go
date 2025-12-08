package hdfs

import "github.com/nucleus/ucl-core/internal/endpoint"

// DatasetDefinitions defines available HDFS datasets.
var DatasetDefinitions = []*endpoint.Dataset{
	{
		ID:   "hdfs.file",
		Name: "HDFS Files",
		Kind: "entity",
	},
	{
		ID:   "hdfs.directory",
		Name: "HDFS Directories",
		Kind: "entity",
	},
}

// FileSchema returns the schema for hdfs.file dataset.
var FileSchema = &endpoint.Schema{
	Fields: []*endpoint.FieldDefinition{
		{Name: "path", DataType: "STRING", Nullable: false},
		{Name: "name", DataType: "STRING", Nullable: false},
		{Name: "size", DataType: "INT64", Nullable: false},
		{Name: "modificationTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "accessTime", DataType: "TIMESTAMP", Nullable: true},
		{Name: "owner", DataType: "STRING", Nullable: true},
		{Name: "group", DataType: "STRING", Nullable: true},
		{Name: "permission", DataType: "STRING", Nullable: true},
		{Name: "replication", DataType: "INT32", Nullable: true},
		{Name: "blockSize", DataType: "INT64", Nullable: true},
	},
}

// DirectorySchema returns the schema for hdfs.directory dataset.
var DirectorySchema = &endpoint.Schema{
	Fields: []*endpoint.FieldDefinition{
		{Name: "path", DataType: "STRING", Nullable: false},
		{Name: "name", DataType: "STRING", Nullable: false},
		{Name: "modificationTime", DataType: "TIMESTAMP", Nullable: false},
		{Name: "owner", DataType: "STRING", Nullable: true},
		{Name: "group", DataType: "STRING", Nullable: true},
		{Name: "permission", DataType: "STRING", Nullable: true},
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
	case "hdfs.file":
		return FileSchema
	case "hdfs.directory":
		return DirectorySchema
	default:
		return nil
	}
}
