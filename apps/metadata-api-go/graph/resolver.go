// Package graph provides GraphQL resolvers for the metadata-api.
package graph

import (
	"github.com/nucleus/metadata-api/internal/database"
)

// Resolver is the root resolver for GraphQL queries and mutations.
type Resolver struct {
	db *database.Client
}

// NewResolver creates a new resolver with the given dependencies.
func NewResolver(db *database.Client) *Resolver {
	return &Resolver{
		db: db,
	}
}
