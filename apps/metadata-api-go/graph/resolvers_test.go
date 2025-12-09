// Package graph provides tests for GraphQL resolvers.
package graph

import (
	"context"
	"testing"
)

func TestHealth(t *testing.T) {
	// Create resolver with nil db (health doesn't need it)
	resolver := &Resolver{db: nil}
	queryResolver := resolver.Query()

	health, err := queryResolver.Health(context.Background())
	if err != nil {
		t.Fatalf("Health() returned error: %v", err)
	}

	if health == nil {
		t.Fatal("Health() returned nil")
	}

	if health.Status != "ok" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "ok")
	}

	if health.Version == "" {
		t.Error("Health.Version is empty")
	}
}

func TestMapEndpointToGraphQL(t *testing.T) {
	// Test nil input
	result := mapEndpointToGraphQL(nil)
	if result != nil {
		t.Error("mapEndpointToGraphQL(nil) should return nil")
	}
}

func TestMapRecordToGraphQL(t *testing.T) {
	// Test nil input
	result := mapRecordToGraphQL(nil)
	if result != nil {
		t.Error("mapRecordToGraphQL(nil) should return nil")
	}
}

func TestNullableString(t *testing.T) {
	// Test valid NullableString
	// Note: NullableString is sql.NullString
	// We'd need to import the database package for full tests
}

func TestStrPtr(t *testing.T) {
	s := strPtr("test")
	if s == nil {
		t.Fatal("strPtr returned nil")
	}
	if *s != "test" {
		t.Errorf("strPtr = %q, want %q", *s, "test")
	}
}
