package activities

import (
	"context"
	"os"

	signalpb "github.com/nucleus/store-core/gen/go/signalpb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
)

// signalClient wraps the store-core SignalService.
type signalClient struct {
	cc     *grpc.ClientConn
	client signalpb.SignalServiceClient
}

func newSignalClient() (*signalClient, error) {
	addr := os.Getenv("SIGNAL_GRPC_ADDR")
	if addr == "" {
		addr = "localhost:9099"
	}
	cc, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &signalClient{
		cc:     cc,
		client: signalpb.NewSignalServiceClient(cc),
	}, nil
}

func (c *signalClient) Close() error {
	if c.cc != nil {
		return c.cc.Close()
	}
	return nil
}

func (c *signalClient) upsertDefinition(ctx context.Context, def signalpb.Definition) (string, error) {
	resp, err := c.client.UpsertDefinition(ctx, &signalpb.UpsertDefinitionRequest{Definition: &def})
	if err != nil {
		return "", err
	}
	return resp.GetId(), nil
}

func (c *signalClient) listDefinitions(ctx context.Context, sourceFamily string) ([]*signalpb.Definition, error) {
	resp, err := c.client.ListDefinitions(ctx, &signalpb.ListDefinitionsRequest{SourceFamily: sourceFamily})
	if err != nil {
		return nil, err
	}
	return resp.GetDefinitions(), nil
}

func (c *signalClient) listInstances(ctx context.Context, defID string) ([]*signalpb.Instance, error) {
	resp, err := c.client.ListInstancesForDefinition(ctx, &signalpb.ListInstancesForDefinitionRequest{DefinitionId: defID})
	if err != nil {
		return nil, err
	}
	return resp.GetInstances(), nil
}

func (c *signalClient) upsertInstance(ctx context.Context, inst signalpb.Instance) error {
	_, err := c.client.UpsertInstance(ctx, &signalpb.UpsertInstanceRequest{Instance: &inst})
	return err
}

func (c *signalClient) updateInstanceStatus(ctx context.Context, definitionID, entityRef, status string) error {
	_, err := c.client.UpdateInstanceStatus(ctx, &signalpb.UpdateInstanceStatusRequest{
		DefinitionId: definitionID,
		EntityRef:    entityRef,
		Status:       status,
	})
	return err
}

func structToPB(m map[string]any) *structpb.Struct {
	if len(m) == 0 {
		return nil
	}
	pb, _ := structpb.NewStruct(m)
	return pb
}
