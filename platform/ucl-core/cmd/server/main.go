// Package main implements the UCL gRPC server.
package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/nucleus/ucl-core/internal/endpoint"
	// Import connector package to register all connectors
	_ "github.com/nucleus/ucl-core/pkg/connector"
)

// Note: This is a placeholder implementation.
// Full gRPC requires protoc-generated stubs which need the proto compiler.
// For now, this demonstrates the structure.

// server implements the UCL service.
type server struct{}

func main() {
	port := os.Getenv("UCL_GRPC_PORT")
	if port == "" {
		port = "50051"
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer()
	// TODO: Register service once protoc stubs are generated
	// pb.RegisterUCLServiceServer(s, &server{})

	// Enable reflection for debugging with grpcurl
	reflection.Register(s)

	log.Printf("UCL gRPC server listening on :%s", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}

// ListEndpointTemplates returns available endpoint templates.
func (s *server) ListEndpointTemplates(ctx context.Context, family string) ([]EndpointTemplate, error) {
	registry := endpoint.DefaultRegistry()
	ids := registry.List()

	templates := make([]EndpointTemplate, 0, len(ids))
	for _, id := range ids {
		// Filter by family if specified
		if family != "" && !matchesFamily(id, family) {
			continue
		}

		templates = append(templates, EndpointTemplate{
			ID:     id,
			Family: extractFamily(id),
		})
	}

	return templates, nil
}

// TestEndpointConnection tests connectivity to an endpoint.
func (s *server) TestEndpointConnection(ctx context.Context, templateID string, params map[string]any) error {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(templateID)
	if !ok {
		return fmt.Errorf("unknown template ID: %s", templateID)
	}

	// Create endpoint
	ep, err := factory(params)
	if err != nil {
		return err
	}

	// Validate config
	result, err := ep.ValidateConfig(ctx, params)
	if err != nil {
		return err
	}

	if !result.Valid {
		return fmt.Errorf("validation failed: %s", result.Message)
	}

	return nil
}

// ListDatasets returns available datasets for an endpoint.
func (s *server) ListDatasets(ctx context.Context, templateID string, config map[string]any) ([]*endpoint.Dataset, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(templateID)
	if !ok {
		return nil, fmt.Errorf("unknown template ID: %s", templateID)
	}

	ep, err := factory(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	sourceEp, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint does not support listing datasets")
	}

	return sourceEp.ListDatasets(ctx)
}

// GetSchema returns the schema for a dataset.
func (s *server) GetSchema(ctx context.Context, templateID, datasetID string, config map[string]any) (*endpoint.Schema, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(templateID)
	if !ok {
		return nil, fmt.Errorf("unknown template ID: %s", templateID)
	}

	ep, err := factory(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	sourceEp, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint does not support getting schema")
	}

	return sourceEp.GetSchema(ctx, datasetID)
}

// EndpointTemplate represents an endpoint template.
type EndpointTemplate struct {
	ID          string
	Family      string
	DisplayName string
}

// Helper to extract family from template ID (e.g., "jdbc.postgres" -> "JDBC")
func extractFamily(id string) string {
	if len(id) < 4 {
		return "OTHER"
	}
	switch id[:4] {
	case "jdbc":
		return "JDBC"
	case "http":
		return "HTTP"
	case "hdfs":
		return "STREAM"
	case "clou":
		return "CLOUD"
	default:
		return "OTHER"
	}
}

// Helper to check if template matches family filter
func matchesFamily(id, family string) bool {
	return extractFamily(id) == family
}
