// Package graph provides GraphQL resolvers for the metadata-api.
// This file contains the initial resolver implementations.
package graph

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/nucleus/metadata-api/internal/auth"
	"github.com/nucleus/metadata-api/internal/database"
)

// =============================================================================
// QUERY RESOLVERS
// =============================================================================

// Query returns QueryResolver implementation.
func (r *Resolver) Query() *queryResolver {
	return &queryResolver{r}
}

type queryResolver struct{ *Resolver }

// Health returns the service health status.
func (r *queryResolver) Health(ctx context.Context) (*Health, error) {
	return &Health{
		Status:  "ok",
		Version: "0.1.0",
	}, nil
}

// MetadataEndpoints returns endpoints with optional filtering.
func (r *queryResolver) MetadataEndpoints(ctx context.Context, projectID *string, includeDeleted *bool) ([]*MetadataEndpoint, error) {
	authCtx := auth.FromContext(ctx)
	effectiveProjectID := projectID
	if effectiveProjectID == nil && authCtx.ProjectID != "" {
		effectiveProjectID = &authCtx.ProjectID
	}

	include := false
	if includeDeleted != nil {
		include = *includeDeleted
	}

	endpoints, err := r.db.ListEndpoints(ctx, effectiveProjectID, include)
	if err != nil {
		return nil, err
	}

	result := make([]*MetadataEndpoint, len(endpoints))
	for i, ep := range endpoints {
		result[i] = mapEndpointToGraphQL(ep)
	}
	return result, nil
}

// MetadataEndpoint returns a single endpoint by ID.
func (r *queryResolver) MetadataEndpoint(ctx context.Context, id string) (*MetadataEndpoint, error) {
	ep, err := r.db.GetEndpoint(ctx, id)
	if err != nil {
		return nil, err
	}
	if ep == nil {
		return nil, nil
	}
	return mapEndpointToGraphQL(ep), nil
}

// Endpoint returns a single endpoint by ID (alias).
func (r *queryResolver) Endpoint(ctx context.Context, id string) (*MetadataEndpoint, error) {
	return r.MetadataEndpoint(ctx, id)
}

// EndpointBySourceID returns an endpoint by source ID.
func (r *queryResolver) EndpointBySourceID(ctx context.Context, sourceID string) (*MetadataEndpoint, error) {
	ep, err := r.db.GetEndpointBySourceID(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	if ep == nil {
		return nil, nil
	}
	return mapEndpointToGraphQL(ep), nil
}

// MetadataRecords returns metadata records with filtering.
func (r *queryResolver) MetadataRecords(ctx context.Context, domain string, projectID *string, labels []string, search *string, limit *int) ([]*MetadataRecord, error) {
	authCtx := auth.FromContext(ctx)
	effectiveProjectID := projectID
	if effectiveProjectID == nil && authCtx.ProjectID != "" {
		effectiveProjectID = &authCtx.ProjectID
	}

	effectiveLimit := 100
	if limit != nil && *limit > 0 {
		effectiveLimit = *limit
	}

	records, err := r.db.ListRecords(ctx, domain, effectiveProjectID, labels, search, effectiveLimit)
	if err != nil {
		return nil, err
	}

	result := make([]*MetadataRecord, len(records))
	for i, rec := range records {
		result[i] = mapRecordToGraphQL(rec)
	}
	return result, nil
}

// =============================================================================
// MUTATION RESOLVERS
// =============================================================================

// Mutation returns MutationResolver implementation.
func (r *Resolver) Mutation() *mutationResolver {
	return &mutationResolver{r}
}

type mutationResolver struct{ *Resolver }

// UpsertMetadataRecord creates or updates a metadata record.
func (r *mutationResolver) UpsertMetadataRecord(ctx context.Context, input MetadataRecordInput) (*MetadataRecord, error) {
	id := ""
	if input.ID != nil {
		id = *input.ID
	} else {
		id = uuid.New().String()
	}

	record := &database.MetadataRecord{
		ID:        id,
		Domain:    input.Domain,
		ProjectID: input.ProjectID,
		Labels:    input.Labels,
		Payload:   input.Payload,
	}

	result, err := r.db.UpsertRecord(ctx, record)
	if err != nil {
		return nil, err
	}
	return mapRecordToGraphQL(result), nil
}

// RegisterMetadataEndpoint registers a new endpoint.
func (r *mutationResolver) RegisterMetadataEndpoint(ctx context.Context, input MetadataEndpointInput) (*MetadataEndpoint, error) {
	authCtx := auth.FromContext(ctx)

	ep := &database.MetadataEndpoint{
		Name: input.Name,
		Verb: "POST",
		URL:  "",
	}

	if input.ID != nil {
		ep.ID = *input.ID
	}
	if input.Verb != nil {
		ep.Verb = *input.Verb
	}
	if input.URL != nil {
		ep.URL = *input.URL
	}
	if input.SourceID != nil {
		ep.SourceID.String = *input.SourceID
		ep.SourceID.Valid = true
	}
	if input.ProjectID != nil {
		ep.ProjectID.String = *input.ProjectID
		ep.ProjectID.Valid = true
	} else if authCtx.ProjectID != "" {
		ep.ProjectID.String = authCtx.ProjectID
		ep.ProjectID.Valid = true
	}
	if input.Description != nil {
		ep.Description.String = *input.Description
		ep.Description.Valid = true
	}
	if input.AuthPolicy != nil {
		ep.AuthPolicy.String = *input.AuthPolicy
		ep.AuthPolicy.Valid = true
	}
	if input.Domain != nil {
		ep.Domain.String = *input.Domain
		ep.Domain.Valid = true
	}
	ep.Labels = input.Labels
	ep.Config = input.Config

	result, err := r.db.UpsertEndpoint(ctx, ep)
	if err != nil {
		return nil, err
	}
	return mapEndpointToGraphQL(result), nil
}

// DeleteMetadataEndpoint soft-deletes an endpoint.
func (r *mutationResolver) DeleteMetadataEndpoint(ctx context.Context, id string, reason *string) (*MetadataEndpoint, error) {
	if err := r.db.SoftDeleteEndpoint(ctx, id, reason); err != nil {
		return nil, err
	}
	return r.Query().MetadataEndpoint(ctx, id)
}

// =============================================================================
// HELPERS
// =============================================================================

func mapEndpointToGraphQL(ep *database.MetadataEndpoint) *MetadataEndpoint {
	if ep == nil {
		return nil
	}
	return &MetadataEndpoint{
		ID:                 ep.ID,
		SourceID:           nullableString(ep.SourceID),
		ProjectID:          nullableStringPtr(ep.ProjectID),
		Name:               ep.Name,
		Description:        nullableStringPtr(ep.Description),
		Verb:               ep.Verb,
		URL:                ep.URL,
		AuthPolicy:         nullableStringPtr(ep.AuthPolicy),
		Domain:             nullableStringPtr(ep.Domain),
		Labels:             ep.Labels,
		Config:             ep.Config,
		DetectedVersion:    nullableStringPtr(ep.DetectedVersion),
		VersionHint:        nullableStringPtr(ep.VersionHint),
		Capabilities:       ep.Capabilities,
		DelegatedConnected: &ep.DelegatedConnected,
		CreatedAt:          &ep.CreatedAt,
		UpdatedAt:          &ep.UpdatedAt,
		DeletedAt:          nullableTimePtr(ep.DeletedAt),
		DeletionReason:     nullableStringPtr(ep.DeletionReason),
		IsDeleted:          ep.DeletedAt.Valid,
	}
}

func mapRecordToGraphQL(rec *database.MetadataRecord) *MetadataRecord {
	if rec == nil {
		return nil
	}
	return &MetadataRecord{
		ID:        rec.ID,
		ProjectID: rec.ProjectID,
		Domain:    rec.Domain,
		Labels:    rec.Labels,
		Payload:   rec.Payload,
		CreatedAt: rec.CreatedAt,
		UpdatedAt: rec.UpdatedAt,
	}
}

func nullableString(s database.NullableString) string {
	if s.Valid {
		return s.String
	}
	return ""
}

func nullableStringPtr(s database.NullableString) *string {
	if s.Valid {
		return &s.String
	}
	return nil
}

func nullableTimePtr(t database.NullableTime) *time.Time {
	if t.Valid {
		return &t.Time
	}
	return nil
}
