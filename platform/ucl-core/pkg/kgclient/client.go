package kgclient

import (
	"context"
	"fmt"

	kgpb "github.com/nucleus/ucl-core/pkg/kgpb"
)

// Client wraps the KG repository for simple upserts.
type Client struct {
	repo kgRepository
}

type kgRepository interface {
	upsertNode(ctx context.Context, req *kgpb.UpsertNodeRequest) (*kgpb.Node, error)
	upsertEdge(ctx context.Context, req *kgpb.UpsertEdgeRequest) (*kgpb.Edge, error)
}

// NewFromPool constructs a KG client using the gateway repo helpers.
func NewFromPool(_ interface{}) *Client {
	// Stubbed: attach a repo if needed.
	return &Client{}
}

// UpsertSignalNode inserts/updates a signal node.
func (c *Client) UpsertSignalNode(ctx context.Context, tenant, project, id, title, severity string, props map[string]string) (*kgpb.Node, error) {
	if c == nil || c.repo == nil {
		return nil, fmt.Errorf("kg repo unavailable")
	}
	if props == nil {
		props = map[string]string{}
	}
	props["severity"] = severity
	return c.repo.upsertNode(ctx, &kgpb.UpsertNodeRequest{
		TenantId:  tenant,
		ProjectId: project,
		Node: &kgpb.Node{
			Id:         id,
			Type:       "signal",
			Properties: props,
		},
	})
}

// UpsertEdge inserts/updates an edge.
func (c *Client) UpsertEdge(ctx context.Context, tenant, project, id, edgeType, from, to string, props map[string]string) (*kgpb.Edge, error) {
	if c == nil || c.repo == nil {
		return nil, fmt.Errorf("kg repo unavailable")
	}
	return c.repo.upsertEdge(ctx, &kgpb.UpsertEdgeRequest{
		TenantId:  tenant,
		ProjectId: project,
		Edge: &kgpb.Edge{
			Id:         id,
			Type:       edgeType,
			FromId:     from,
			ToId:       to,
			Properties: props,
		},
	})
}
