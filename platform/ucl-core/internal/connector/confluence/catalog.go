package confluence

import (
	"github.com/nucleus/ucl-core/internal/core/cdm"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// API Library - Confluence REST API endpoints
var APILibrary = map[string]APIEndpoint{
	"space_search": {
		Method:      "GET",
		Path:        "/wiki/rest/api/space",
		Description: "List spaces visible to the authenticated account.",
		Scope:       "spaces",
	},
	"space_detail": {
		Method:      "GET",
		Path:        "/wiki/rest/api/space/{spaceKey}",
		Description: "Fetch a space by key to access metadata and permissions.",
		Scope:       "spaces",
	},
	"content_search": {
		Method:      "GET",
		Path:        "/wiki/rest/api/content",
		Description: "Enumerate pages via cursor pagination and optional space filters.",
		Scope:       "pages",
	},
	"content_detail": {
		Method:      "GET",
		Path:        "/wiki/rest/api/content/{id}",
		Description: "Fetch a single page with rendered body content.",
		Scope:       "pages",
	},
	"attachment_list": {
		Method:      "GET",
		Path:        "/wiki/rest/api/content/{id}/child/attachment",
		Description: "List attachments belonging to a page.",
		Scope:       "attachments",
	},
	"user_current": {
		Method:      "GET",
		Path:        "/wiki/rest/api/user/current",
		Description: "Verify authenticated user metadata.",
		Scope:       "users",
	},
	"system_info": {
		Method:      "GET",
		Path:        "/wiki/rest/api/settings/systemInfo",
		Description: "Fetch Confluence site/system information.",
		Scope:       "system",
	},
}

// APIEndpoint describes a Confluence API endpoint.
type APIEndpoint struct {
	Method      string
	Path        string
	Description string
	Scope       string
}

// Dataset definitions with CDM mappings
var DatasetDefinitions = map[string]*DatasetDefinition{
	"confluence.space": {
		ID:          "confluence.space",
		Name:        "Confluence Spaces",
		Kind:        "entity",
		Description: "Logical Confluence spaces (wiki areas) with metadata such as status, type, and links.",
		CdmModelID:  cdm.ModelDocSpace,
		Fields: []*endpoint.FieldDefinition{
			{Name: "spaceKey", DataType: "STRING", Nullable: false},
			{Name: "name", DataType: "STRING", Nullable: false},
			{Name: "type", DataType: "STRING", Nullable: true},
			{Name: "status", DataType: "STRING", Nullable: true},
			{Name: "url", DataType: "STRING", Nullable: true},
			{Name: "description", DataType: "STRING", Nullable: true},
			{Name: "_raw", DataType: "JSON", Nullable: true},
		},
		SupportsIncremental: false,
		APIKeys:             []string{"space_search", "space_detail"},
	},
	"confluence.page": {
		ID:          "confluence.page",
		Name:        "Confluence Pages",
		Kind:        "entity",
		Description: "Pages/articles stored within spaces including creator/updater metadata.",
		CdmModelID:  cdm.ModelDocItem,
		Fields: []*endpoint.FieldDefinition{
			{Name: "pageId", DataType: "STRING", Nullable: false},
			{Name: "spaceKey", DataType: "STRING", Nullable: false},
			{Name: "title", DataType: "STRING", Nullable: false},
			{Name: "status", DataType: "STRING", Nullable: true},
			{Name: "contentType", DataType: "STRING", Nullable: true}, // page, blogpost
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "updatedAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "author", DataType: "STRING", Nullable: true},
			{Name: "updatedBy", DataType: "STRING", Nullable: true},
			{Name: "url", DataType: "STRING", Nullable: true},
			{Name: "_raw", DataType: "JSON", Nullable: true},
		},
		SupportsIncremental: true,
		IncrementalField:    "updatedAt",
		APIKeys:             []string{"content_search", "content_detail"},
	},
	"confluence.attachment": {
		ID:          "confluence.attachment",
		Name:        "Confluence Attachments",
		Kind:        "entity",
		Description: "Attachments stored on pages (files, media) with MIME types and sizes.",
		CdmModelID:  cdm.ModelDocLink,
		Fields: []*endpoint.FieldDefinition{
			{Name: "attachmentId", DataType: "STRING", Nullable: false},
			{Name: "pageId", DataType: "STRING", Nullable: false},
			{Name: "title", DataType: "STRING", Nullable: false},
			{Name: "mediaType", DataType: "STRING", Nullable: true},
			{Name: "fileSize", DataType: "LONG", Nullable: true},
			{Name: "downloadLink", DataType: "STRING", Nullable: true},
			{Name: "createdAt", DataType: "TIMESTAMP", Nullable: true},
			{Name: "createdBy", DataType: "STRING", Nullable: true},
			{Name: "_raw", DataType: "JSON", Nullable: true},
		},
		SupportsIncremental: true,
		IncrementalField:    "createdAt",
		APIKeys:             []string{"attachment_list"},
	},
	"confluence.acl": {
		ID:          "confluence.acl",
		Name:        "Confluence ACL",
		Kind:        "entity",
		Description: "Access control mappings from principals (users/groups) to docs.",
		CdmModelID:  "cdm.doc.access",
		Fields: []*endpoint.FieldDefinition{
			{Name: "principalId", DataType: "STRING", Nullable: false},
			{Name: "principalType", DataType: "STRING", Nullable: false},
			{Name: "docCdmId", DataType: "STRING", Nullable: false},
			{Name: "accessMode", DataType: "STRING", Nullable: true},
			{Name: "grantedAt", DataType: "TIMESTAMP", Nullable: true},
		},
		SupportsIncremental: true,
		APIKeys:             []string{},
	},
}

// DatasetDefinition describes a Confluence dataset.
type DatasetDefinition struct {
	ID                  string
	Name                string
	Kind                string
	Description         string
	CdmModelID          string
	Fields              []*endpoint.FieldDefinition
	SupportsIncremental bool
	IncrementalField    string
	APIKeys             []string
}

// ToDataset converts a DatasetDefinition to endpoint.Dataset.
func (d *DatasetDefinition) ToDataset() *endpoint.Dataset {
	return &endpoint.Dataset{
		ID:                  d.ID,
		Name:                d.Name,
		Kind:                d.Kind,
		CdmModelID:          d.CdmModelID,
		SupportsIncremental: d.SupportsIncremental,
	}
}

// GetSchemaFields returns the field definitions for a dataset.
func GetSchemaFields(datasetID string) []*endpoint.FieldDefinition {
	if def, ok := DatasetDefinitions[datasetID]; ok {
		return def.Fields
	}
	return nil
}
