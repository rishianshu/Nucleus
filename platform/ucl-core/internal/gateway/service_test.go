package gateway

import (
	"context"
	"testing"

	gatewayv1 "github.com/nucleus/ucl-core/gen/gateway/v1"
	"github.com/nucleus/ucl-core/internal/endpoint"
	"google.golang.org/protobuf/types/known/structpb"
)

// dummyActionEP implements ActionEndpoint for tests.
type dummyActionEP struct{}

func (d *dummyActionEP) Close() error { return nil }

func (d *dummyActionEP) ID() string { return "test.action" }

func (d *dummyActionEP) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{ID: "test.action"}
}

func (d *dummyActionEP) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return []*endpoint.ActionDescriptor{
		{ID: "test.ping", Description: "ping"},
	}, nil
}

func (d *dummyActionEP) GetActionSchema(ctx context.Context, id string) (*endpoint.ActionSchema, error) {
	return nil, nil
}

func (d *dummyActionEP) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	return &endpoint.ActionResult{Success: true, Data: map[string]any{"echo": req.ActionID}}, nil
}

// Other endpoint interfaces not needed for action tests.
func (d *dummyActionEP) ValidateConfig(ctx context.Context, params map[string]any) (*endpoint.ValidationResult, error) {
	return &endpoint.ValidationResult{Valid: true}, nil
}

func (d *dummyActionEP) GetCapabilities() *endpoint.Capabilities { return &endpoint.Capabilities{} }

func TestGatewayListAndExecuteActions(t *testing.T) {
	// register a lightweight endpoint factory
	endpoint.DefaultRegistry().Register("test.action", func(map[string]any) (endpoint.Endpoint, error) {
		return &dummyActionEP{}, nil
	})

	svc := NewService()

	// ListActions
	listResp, err := svc.ListActions(context.Background(), &gatewayv1.ListActionsRequest{
		EndpointTemplateId: "test.action",
	})
	if err != nil {
		t.Fatalf("ListActions error: %v", err)
	}
	if len(listResp.GetActions()) != 1 || listResp.GetActions()[0].GetName() != "test.ping" {
		t.Fatalf("unexpected actions: %+v", listResp.GetActions())
	}

	// ExecuteAction
	pbParams, _ := structpb.NewStruct(map[string]any{})
	execResp, err := svc.ExecuteAction(context.Background(), &gatewayv1.ExecuteActionRequest{
		EndpointId: "test.action",
		ActionName: "test.ping",
		Parameters: pbParams,
		Mode:       gatewayv1.ExecutionMode_EXECUTION_MODE_SYNC,
	})
	if err != nil {
		t.Fatalf("ExecuteAction error: %v", err)
	}
	if execResp.GetResult() == nil || execResp.GetResult().AsMap()["echo"] != "test.ping" {
		t.Fatalf("unexpected execute response: %+v", execResp.GetResult())
	}
}
