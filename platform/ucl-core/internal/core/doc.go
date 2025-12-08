// Package core provides shared data models used across all UCL components.
// These models are implementation-agnostic and can be consumed by both
// connectors and orchestration services.
//
// Structure:
//
//	metadata.go   - MetadataRecord, Target, Context, protocols
//	schema.go     - Schema drift detection models
//	requests.go   - Ingestion request/result models
//	cdm/          - Common Data Model entities
package core
