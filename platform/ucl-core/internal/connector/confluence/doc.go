// Package confluence implements the Confluence Cloud connector for UCL.
// It extends the HTTP base connector and implements SourceEndpoint, SliceCapable,
// and MetadataCapable interfaces with CDM mappings for the docs domain.
//
// Datasets:
//   - confluence.space → cdm.doc.space
//   - confluence.page → cdm.doc.item
//   - confluence.attachment → cdm.doc.link
//   - confluence.acl → cdm.doc.access
package confluence
