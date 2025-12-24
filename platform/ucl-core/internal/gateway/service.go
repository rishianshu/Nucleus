package gateway

import (
	"context"

	"github.com/nucleus/ucl-core/gen/gateway/v1"
	"github.com/nucleus/ucl-core/internal/endpoint"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// Service implements GatewayService.
type Service struct {
	gatewayv1.UnimplementedGatewayServiceServer
}

func NewService() *Service { return &Service{} }

func (s *Service) ListActions(ctx context.Context, req *gatewayv1.ListActionsRequest) (*gatewayv1.ListActionsResponse, error) {
	templateID := req.GetEndpointTemplateId()
	if templateID == "" {
		return nil, status.Error(codes.InvalidArgument, "endpoint_template_id is required")
	}
	ep, err := endpoint.DefaultRegistry().Create(templateID, map[string]any{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create endpoint: %v", err)
	}
	defer ep.Close()

	actionEp, ok := ep.(endpoint.ActionEndpoint)
	if !ok {
		return &gatewayv1.ListActionsResponse{}, nil
	}
	actions, err := actionEp.ListActions(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list actions: %v", err)
	}
	resp := &gatewayv1.ListActionsResponse{}
	for _, a := range actions {
		resp.Actions = append(resp.Actions, &gatewayv1.ActionSchema{
			Name:            a.ID,
			Description:     a.Description,
			InputSchemaJson: "", // Placeholder until JSON schema is provided
		})
	}
	return resp, nil
}

func (s *Service) ExecuteAction(ctx context.Context, req *gatewayv1.ExecuteActionRequest) (*gatewayv1.ExecuteActionResponse, error) {
	if req.GetEndpointId() == "" || req.GetActionName() == "" {
		return nil, status.Error(codes.InvalidArgument, "endpoint_id and action_name are required")
	}
	ep, err := endpoint.DefaultRegistry().Create(req.GetEndpointId(), map[string]any{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create endpoint: %v", err)
	}
	defer ep.Close()

	actionEp, ok := ep.(endpoint.ActionEndpoint)
	if !ok {
		return nil, status.Error(codes.Unimplemented, "endpoint does not support actions")
	}
	params := map[string]any{}
	if req.Parameters != nil {
		params = req.Parameters.AsMap()
	}
	res, err := actionEp.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID:   req.GetActionName(),
		Parameters: params,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "execute: %v", err)
	}
	var result *structpb.Struct
	if res != nil && res.Data != nil {
		result, _ = structpb.NewStruct(res.Data)
	}
	return &gatewayv1.ExecuteActionResponse{
		ExecutionId: "",
		Result:      result,
		StatusUrl:   "",
	}, nil
}
