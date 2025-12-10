// Package graph provides GraphQL resolvers for the metadata-api.
package graph

import (
	"go.temporal.io/sdk/client"

	"github.com/nucleus/metadata-api/internal/database"
	"github.com/nucleus/metadata-api/internal/ucl"
)

// Resolver is the root resolver for GraphQL queries and mutations.
type Resolver struct {
	db       *database.Client
	ucl      *ucl.Client
	temporal client.Client
}

// NewResolver creates a new resolver with the given dependencies.
func NewResolver(db *database.Client, uclClient *ucl.Client, temporalClient client.Client) *Resolver {
	return &Resolver{
		db:       db,
		ucl:      uclClient,
		temporal: temporalClient,
	}
}
