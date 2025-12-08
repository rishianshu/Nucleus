// Package gateway implements the UCL Gateway gRPC service.
package gateway

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// Service implements the GatewayService gRPC interface.
type Service struct {
	UnimplementedGatewayServiceServer
}

// NewService creates a new Gateway service instance.
func NewService() *Service {
	return &Service{}
}

// ListEndpoints returns available endpoint templates.
func (s *Service) ListEndpoints(ctx context.Context, req *ListEndpointsRequest) (*ListEndpointsResponse, error) {
	// TODO: Implement connector registry lookup
	return &ListEndpointsResponse{
		Endpoints: []*EndpointDescription{
			{
				TemplateId:  "jdbc.postgres",
				Family:      "jdbc",
				DisplayName: "PostgreSQL",
				Description: "Connect to PostgreSQL databases",
			},
			{
				TemplateId:  "http.jira",
				Family:      "jira",
				DisplayName: "Jira",
				Description: "Connect to Atlassian Jira",
			},
		},
	}, nil
}

// GetEndpointDescriptor returns detailed endpoint descriptor.
func (s *Service) GetEndpointDescriptor(ctx context.Context, req *GetEndpointDescriptorRequest) (*GetEndpointDescriptorResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "GetEndpointDescriptor not implemented")
}

// GetSchema returns schema for a dataset.
func (s *Service) GetSchema(ctx context.Context, req *GetSchemaRequest) (*GetSchemaResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "GetSchema not implemented")
}

// ReadData streams data from a dataset.
func (s *Service) ReadData(req *ReadDataRequest, stream GatewayService_ReadDataServer) error {
	return status.Errorf(codes.Unimplemented, "ReadData not implemented")
}

// WriteData writes data to a dataset.
func (s *Service) WriteData(ctx context.Context, req *WriteDataRequest) (*WriteDataResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "WriteData not implemented")
}

// GetLatestWatermark returns the latest watermark for a dataset.
func (s *Service) GetLatestWatermark(ctx context.Context, req *GetLatestWatermarkRequest) (*GetLatestWatermarkResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "GetLatestWatermark not implemented")
}

// ExecuteAction executes an action on an endpoint.
func (s *Service) ExecuteAction(ctx context.Context, req *ExecuteActionRequest) (*ExecuteActionResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "ExecuteAction not implemented")
}

// Placeholder types until proto generation is working
// These will be replaced by generated code from api/v1/gateway.proto

type UnimplementedGatewayServiceServer struct{}

type ListEndpointsRequest struct {
	Environment string
}

type ListEndpointsResponse struct {
	Endpoints []*EndpointDescription
}

type EndpointDescription struct {
	TemplateId  string
	Family      string
	DisplayName string
	Description string
}

type GetEndpointDescriptorRequest struct {
	EndpointId string
}

type GetEndpointDescriptorResponse struct{}

type GetSchemaRequest struct {
	EndpointId string
	DatasetId  string
	Config     *structpb.Struct
}

type GetSchemaResponse struct{}

type ReadDataRequest struct {
	EndpointId string
	DatasetId  string
}

type GatewayService_ReadDataServer interface {
	grpc.ServerStream
}

type WriteDataRequest struct{}
type WriteDataResponse struct{}

type GetLatestWatermarkRequest struct{}
type GetLatestWatermarkResponse struct{}

type ExecuteActionRequest struct{}
type ExecuteActionResponse struct{}

// RegisterGatewayServiceServer registers the service with a gRPC server.
func RegisterGatewayServiceServer(s *grpc.Server, srv *Service) {
	// This is a placeholder - will be replaced by generated code
	// s.RegisterService(&GatewayService_ServiceDesc, srv)
}
