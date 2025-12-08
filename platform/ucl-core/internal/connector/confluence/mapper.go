package confluence

import (
	"github.com/nucleus/ucl-core/internal/core/cdm"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// CDMMapper provides CDM mapping functions for Confluence records.
type CDMMapper struct{}

// NewCDMMapper creates a new CDM mapper for Confluence.
func NewCDMMapper() *CDMMapper {
	return &CDMMapper{}
}

// MapRecord maps a raw Confluence record to its CDM equivalent.
func (m *CDMMapper) MapRecord(datasetID string, record endpoint.Record) any {
	switch datasetID {
	case "confluence.space":
		return m.mapSpace(record)
	case "confluence.page":
		return m.mapPage(record)
	case "confluence.attachment":
		return m.mapAttachment(record)
	default:
		return record
	}
}

func (m *CDMMapper) mapSpace(record endpoint.Record) *cdm.DocSpace {
	return &cdm.DocSpace{
		CdmID:         cdm.DocSpaceID("confluence", getString(record, "spaceKey")),
		SourceSystem:  "confluence",
		SourceSpaceID: getString(record, "spaceKey"),
		Key:           getString(record, "spaceKey"),
		Name:          getString(record, "name"),
		Description:   getString(record, "description"),
		URL:           getString(record, "url"),
		Properties:    map[string]any{"type": getString(record, "type"), "status": getString(record, "status")},
	}
}

func (m *CDMMapper) mapPage(record endpoint.Record) *cdm.DocItem {
	return &cdm.DocItem{
		CdmID:        cdm.DocItemID("confluence", getString(record, "pageId")),
		SourceSystem: "confluence",
		SourceItemID: getString(record, "pageId"),
		SpaceCdmID:   cdm.DocSpaceID("confluence", getString(record, "spaceKey")),
		Title:        getString(record, "title"),
		DocType:      getString(record, "contentType"),
		URL:          getString(record, "url"),
		Properties: map[string]any{
			"status":    getString(record, "status"),
			"author":    getString(record, "author"),
			"updatedBy": getString(record, "updatedBy"),
		},
	}
}

func (m *CDMMapper) mapAttachment(record endpoint.Record) *cdm.DocLink {
	return &cdm.DocLink{
		CdmID:         cdm.DocLinkID("confluence", getString(record, "attachmentId")),
		SourceSystem:  "confluence",
		SourceLinkID:  getString(record, "attachmentId"),
		FromItemCdmID: cdm.DocItemID("confluence", getString(record, "pageId")),
		URL:           getString(record, "downloadLink"),
		LinkType:      "attachment",
		Properties: map[string]any{
			"title":     getString(record, "title"),
			"mediaType": getString(record, "mediaType"),
			"fileSize":  record["fileSize"],
		},
	}
}

func getString(record endpoint.Record, key string) string {
	if v, ok := record[key].(string); ok {
		return v
	}
	return ""
}
