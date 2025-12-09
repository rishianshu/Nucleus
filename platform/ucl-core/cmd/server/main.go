// Package main implements the UCL gRPC server.
// This replaces the Python CLI (endpoint_registry_cli.py) with a Go gRPC service.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	"github.com/nucleus/ucl-core/internal/endpoint"

	// Import connector package to register all connectors
	_ "github.com/nucleus/ucl-core/pkg/connector"
)

// server implements the UCL gRPC service.
type server struct {
	pb.UnimplementedUCLServiceServer
}

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
	pb.RegisterUCLServiceServer(s, &server{})

	// Enable reflection for debugging with grpcurl
	reflection.Register(s)

	log.Printf("UCL gRPC server listening on :%s", port)
	log.Printf("Registered endpoints: %v", endpoint.DefaultRegistry().List())

	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}

// =============================================================================
// LIST ENDPOINT TEMPLATES
// =============================================================================

func (s *server) ListEndpointTemplates(ctx context.Context, req *pb.ListTemplatesRequest) (*pb.ListTemplatesResponse, error) {
	registry := endpoint.DefaultRegistry()
	ids := registry.List()

	templates := make([]*pb.EndpointTemplate, 0, len(ids))
	for _, id := range ids {
		// Filter by family if specified
		family := extractFamily(id)
		if req.Family != "" && strings.ToUpper(req.Family) != family {
			continue
		}

		// Try to get the full descriptor from the endpoint
		desc := getEndpointDescriptor(registry, id)
		
		tpl := &pb.EndpointTemplate{
			Id:          id,
			Family:      family,
			DisplayName: formatDisplayName(id),
			Vendor:      extractVendor(id),
			Description: getTemplateDescription(id),
		}
		
		// Populate additional fields from descriptor if available
			// Populate additional fields from descriptor if available
		if desc != nil {
			tpl.Domain = desc.Domain
			tpl.Protocols = desc.Protocols
			tpl.DefaultPort = int32(desc.DefaultPort)
			tpl.Driver = desc.Driver
			tpl.DocsUrl = desc.DocsURL
			tpl.AgentPrompt = desc.AgentPrompt
			tpl.DefaultLabels = desc.DefaultLabels
			tpl.DescriptorVersion = desc.Version
			tpl.MinVersion = desc.MinVersion
			tpl.MaxVersion = desc.MaxVersion
			tpl.Categories = desc.Categories

			// Map Capabilities
			if len(desc.Capabilities) > 0 {
				caps := make([]*pb.Capability, len(desc.Capabilities))
				for i, c := range desc.Capabilities {
					caps[i] = &pb.Capability{
						Key:         c.Key,
						Label:       c.Label,
						Description: c.Description,
					}
				}
				tpl.Capabilities = caps
			}
			
			// Map Connection Config
			if desc.Connection != nil {
				tpl.Connection = &pb.ConnectionConfig{
					UrlTemplate: desc.Connection.URLTemplate,
					DefaultVerb: desc.Connection.DefaultVerb,
				}
			}
			
			// Map Probing Plan
			if desc.Probing != nil {
				methods := make([]*pb.ProbingMethod, len(desc.Probing.Methods))
				for i, m := range desc.Probing.Methods {
					methods[i] = &pb.ProbingMethod{
						Key:                 m.Key,
						Label:               m.Label,
						Strategy:            m.Strategy,
						Statement:           m.Statement,
						Description:         m.Description,
						Requires:            m.Requires,
						ReturnsVersion:      m.ReturnsVersion,
						ReturnsCapabilities: m.ReturnsCapabilities,
					}
				}
				tpl.Probing = &pb.ProbingPlan{
					Methods:         methods,
					FallbackMessage: desc.Probing.FallbackMessage,
				}
			}

			// Map Extras
			if desc.Extras != nil {
				tpl.Extras = mapAnyToString(desc.Extras)
			}
			
			// Populate fields from descriptor
			if len(desc.Fields) > 0 {
				fields := make([]*pb.FieldDescriptor, len(desc.Fields))
				for i, f := range desc.Fields {
					fields[i] = &pb.FieldDescriptor{
						Name:         f.Key,
						Type:         f.ValueType,
						Label:        f.Label,
						Description:  f.Description,
						Required:     f.Required,
						DefaultValue: f.DefaultValue,
						Placeholder:  f.Placeholder,
						Regex:        f.Regex,
						HelpText:     f.HelpText,
						Semantic:     f.Semantic,
						Advanced:     f.Advanced,
						Sensitive:    f.Sensitive,
						DependsOn:    f.DependsOn,
						DependsValue: f.DependsValue,
						MinValue:     f.MinValue,
						MaxValue:     f.MaxValue,
					}
					
					// Map Options
					if len(f.Options) > 0 {
						opts := make([]string, len(f.Options))
						for j, opt := range f.Options {
							opts[j] = opt.Value // Proto removed Options object, just list of strings or we need to update proto again?
						}
						fields[i].Options = opts
					}
					
					// Map VisibleWhile
					if f.VisibleWhen != nil {
						fields[i].VisibleWhen = &pb.VisibleWhen{
							Field:  f.VisibleWhen.Field,
							Values: f.VisibleWhen.Values,
						}
						// Handle single value legacy case
						if len(f.VisibleWhen.Values) == 0 && f.VisibleWhen.Value != nil {
							fields[i].VisibleWhen.Values = []string{fmt.Sprintf("%v", f.VisibleWhen.Value)}
						}
					}
				}
				tpl.Fields = fields
			}
			
			// Add sample config if available
			if desc.SampleConfig != nil {
				if b, err := json.Marshal(desc.SampleConfig); err == nil {
					tpl.SampleConfig = string(b)
				}
			}
		}
		
		templates = append(templates, tpl)
	}

	return &pb.ListTemplatesResponse{Templates: templates}, nil
}

// getEndpointDescriptor tries to get a Descriptor from the registry
func getEndpointDescriptor(registry *endpoint.Registry, id string) *endpoint.Descriptor {
	factory, ok := registry.Get(id)
	if !ok {
		return nil
	}
	
	// Create a minimal endpoint to get its descriptor
	ep, err := factory(map[string]any{
		"host": "localhost",
		"port": "0",
	})
	if err != nil {
		return nil
	}
	defer ep.Close()
	
	return ep.GetDescriptor()
}

// mapAnyToString converts map[string]any to map[string]string
func mapAnyToString(m map[string]any) map[string]string {
	result := make(map[string]string, len(m))
	for k, v := range m {
		result[k] = fmt.Sprintf("%v", v)
	}
	return result
}

// =============================================================================
// BUILD ENDPOINT CONFIG
// =============================================================================

func (s *server) BuildEndpointConfig(ctx context.Context, req *pb.BuildConfigRequest) (*pb.BuildConfigResponse, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(req.TemplateId)
	if !ok {
		return &pb.BuildConfigResponse{
			Success: false,
			Error:   fmt.Sprintf("unknown template ID: %s", req.TemplateId),
		}, nil
	}

	// Convert string map to any map
	params := make(map[string]any, len(req.Parameters))
	for k, v := range req.Parameters {
		params[k] = v
	}

	// Create endpoint to validate params
	ep, err := factory(params)
	if err != nil {
		return &pb.BuildConfigResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	// Build connection URL from endpoint
	connURL := ""
	if urlProvider, ok := ep.(interface{ ConnectionURL() string }); ok {
		connURL = urlProvider.ConnectionURL()
	}

	return &pb.BuildConfigResponse{
		Success:       true,
		Config:        req.Parameters, // Echo back validated params
		ConnectionUrl: connURL,
	}, nil
}

// =============================================================================
// TEST ENDPOINT CONNECTION
// =============================================================================

func (s *server) TestEndpointConnection(ctx context.Context, req *pb.TestConnectionRequest) (*pb.TestConnectionResponse, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(req.TemplateId)
	if !ok {
		return &pb.TestConnectionResponse{
			Success: false,
			Error:   fmt.Sprintf("unknown template ID: %s", req.TemplateId),
		}, nil
	}

	// Convert string map to any map
	params := make(map[string]any, len(req.Parameters))
	for k, v := range req.Parameters {
		params[k] = v
	}

	start := time.Now()

	// Create endpoint
	ep, err := factory(params)
	if err != nil {
		return &pb.TestConnectionResponse{
			Success:   false,
			Error:     err.Error(),
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	// Validate config (tests connection)
	result, err := ep.ValidateConfig(ctx, params)
	if err != nil {
		return &pb.TestConnectionResponse{
			Success:   false,
			Error:     err.Error(),
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	if !result.Valid {
		return &pb.TestConnectionResponse{
			Success:   false,
			Error:     result.Message,
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	// Build response with all new fields
	resp := &pb.TestConnectionResponse{
		Success:         true,
		Message:         "Connection successful",
		LatencyMs:       time.Since(start).Milliseconds(),
		DetectedVersion: result.DetectedVersion,
	}
	
	// Add capabilities if endpoint supports them
	caps := ep.GetCapabilities()
	if caps != nil {
		var capList []string
		if caps.SupportsFull {
			capList = append(capList, "full")
		}
		if caps.SupportsIncremental {
			capList = append(capList, "incremental")
		}
		if caps.SupportsCountProbe {
			capList = append(capList, "count_probe")
		}
		if caps.SupportsPreview {
			capList = append(capList, "preview")
		}
		if caps.SupportsMetadata {
			capList = append(capList, "metadata")
		}
		resp.Capabilities = capList
	}
	
	return resp, nil
}

// =============================================================================
// VALIDATE CONFIG
// =============================================================================

func (s *server) ValidateConfig(ctx context.Context, req *pb.ValidateConfigRequest) (*pb.ValidateConfigResponse, error) {
	// For now, return valid - real validation would use endpoint
	return &pb.ValidateConfigResponse{
		Valid:    true,
		Errors:   []string{},
		Warnings: []string{},
	}, nil
}

// =============================================================================
// LIST DATASETS
// =============================================================================

func (s *server) ListDatasets(ctx context.Context, req *pb.ListDatasetsRequest) (*pb.ListDatasetsResponse, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(req.EndpointId)
	if !ok {
		return nil, fmt.Errorf("unknown endpoint ID: %s", req.EndpointId)
	}

	// Convert string map to any map
	params := make(map[string]any, len(req.Config))
	for k, v := range req.Config {
		params[k] = v
	}

	ep, err := factory(params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	sourceEp, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint does not support listing datasets")
	}

	datasets, err := sourceEp.ListDatasets(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list datasets: %w", err)
	}

	pbDatasets := make([]*pb.Dataset, len(datasets))
	for i, d := range datasets {
		pbDatasets[i] = &pb.Dataset{
			Id:                  d.ID,
			Name:                d.Name,
			Description:         d.Description,
			Kind:                d.Kind,
			SupportsIncremental: d.SupportsIncremental,
			CdmModelId:          d.CdmModelID,
			IngestionStrategy:   d.IngestionStrategy,
			IncrementalColumn:   d.IncrementalColumn,
			IncrementalLiteral:  d.IncrementalLiteral,
			PrimaryKeys:         d.PrimaryKeys,
			Metadata:            d.Metadata,
		}
	}

	return &pb.ListDatasetsResponse{Datasets: pbDatasets}, nil
}

// =============================================================================
// GET SCHEMA
// =============================================================================

func (s *server) GetSchema(ctx context.Context, req *pb.GetSchemaRequest) (*pb.GetSchemaResponse, error) {
	registry := endpoint.DefaultRegistry()
	factory, ok := registry.Get(req.EndpointId)
	if !ok {
		return nil, fmt.Errorf("unknown endpoint ID: %s", req.EndpointId)
	}

	params := make(map[string]any, len(req.Config))
	for k, v := range req.Config {
		params[k] = v
	}

	ep, err := factory(params)
	if err != nil {
		return nil, fmt.Errorf("failed to create endpoint: %w", err)
	}

	sourceEp, ok := ep.(endpoint.SourceEndpoint)
	if !ok {
		return nil, fmt.Errorf("endpoint does not support getting schema")
	}

	schema, err := sourceEp.GetSchema(ctx, req.DatasetId)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	pbFields := make([]*pb.SchemaField, len(schema.Fields))
	for i, f := range schema.Fields {
		pbFields[i] = &pb.SchemaField{
			Name:         f.Name,
			Type:         f.DataType,
			Nullable:     f.Nullable,
			IsPrimaryKey: false, // Not available in FieldDefinition
			Description:  f.Comment,
			Precision:    int32(f.Precision),
			Scale:        int32(f.Scale),
			Length:       int32(f.Length),
		}
	}

	return &pb.GetSchemaResponse{Fields: pbFields}, nil
}

// =============================================================================
// HELPERS
// =============================================================================

func extractFamily(id string) string {
	if len(id) < 4 {
		return "OTHER"
	}
	prefix := strings.Split(id, ".")[0]
	switch prefix {
	case "jdbc":
		return "JDBC"
	case "http":
		return "HTTP"
	case "hdfs":
		return "STREAM"
	case "cloud":
		return "CLOUD"
	default:
		return "OTHER"
	}
}

func extractVendor(id string) string {
	parts := strings.Split(id, ".")
	if len(parts) >= 2 {
		switch parts[1] {
		case "postgres", "postgresql":
			return "PostgreSQL"
		case "oracle":
			return "Oracle"
		case "sqlserver", "mssql":
			return "Microsoft"
		case "mysql":
			return "MySQL"
		case "jira":
			return "Atlassian"
		case "confluence":
			return "Atlassian"
		case "onedrive":
			return "Microsoft"
		default:
			return strings.Title(parts[1])
		}
	}
	return "Generic"
}

func formatDisplayName(id string) string {
	parts := strings.Split(id, ".")
	if len(parts) >= 2 {
		return strings.Title(parts[1]) + " (" + strings.ToUpper(parts[0]) + ")"
	}
	return id
}

func getTemplateDescription(id string) string {
	descriptions := map[string]string{
		"jdbc.postgres":    "PostgreSQL database connector",
		"jdbc.oracle":      "Oracle database connector",
		"jdbc.sqlserver":   "Microsoft SQL Server connector",
		"jdbc.mysql":       "MySQL database connector",
		"http.jira":        "Atlassian Jira Cloud API",
		"http.confluence":  "Atlassian Confluence Cloud API",
		"http.rest":        "Generic REST API connector",
		"cloud.onedrive":   "Microsoft OneDrive/SharePoint connector",
		"hdfs.webhdfs":     "HDFS via WebHDFS API",
	}
	if desc, ok := descriptions[id]; ok {
		return desc
	}
	return "Connector for " + id
}
