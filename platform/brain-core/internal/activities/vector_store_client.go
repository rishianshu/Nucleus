package activities

import (
	"context"
	"fmt"
	"sync"
	"time"

	vectorpb "github.com/nucleus/store-core/gen/go/vectorpb"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
	"go.temporal.io/sdk/activity"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/structpb"
)

// vectorClient prefers the store-core gRPC service for writes and falls back to
// a local pgvector store for read-heavy operations (ListEntries) until the
// VectorService exposes a list API.
type vectorClient struct {
	grpcAddr string
	conn     *grpc.ClientConn
	grpcCli  vectorpb.VectorServiceClient
}

var (
	vecOnce sync.Once
	vecInst *vectorClient
	vecErr  error
)

func getVectorStore() (*vectorClient, error) {
	vecOnce.Do(func() {
		grpcAddr := getenv("VECTOR_GRPC_ADDR", getenv("STORE_VECTOR_GRPC_ADDR", ""))
		if grpcAddr == "" {
			grpcAddr = "127.0.0.1:9099"
		}

		// Try gRPC first.
		conn, err := grpc.Dial(grpcAddr, grpc.WithInsecure())
		if err != nil {
			vecErr = fmt.Errorf("dial vector grpc %s: %w", grpcAddr, err)
			return
		}

		vecInst = &vectorClient{
			grpcAddr: grpcAddr,
			conn:     conn,
			grpcCli:  vectorpb.NewVectorServiceClient(conn),
		}
	})
	return vecInst, vecErr
}

func (c *vectorClient) Close() {
	if c != nil && c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *vectorClient) UpsertEntries(ctx context.Context, entries []vectorstore.Entry) error {
	if c == nil || c.grpcCli == nil {
		return fmt.Errorf("vector client not initialized")
	}
	req := &vectorpb.UpsertEntriesRequest{}
	for _, e := range entries {
		pb := &vectorpb.Entry{
			TenantId:       e.TenantID,
			ProjectId:      e.ProjectID,
			ProfileId:      e.ProfileID,
			NodeId:         e.NodeID,
			SourceFamily:   e.SourceFamily,
			ArtifactId:     e.ArtifactID,
			RunId:          e.RunID,
			SinkEndpointId: e.SinkEndpointID,
			DatasetSlug:    e.DatasetSlug,
			EntityKind:     e.EntityKind,
			Labels:         e.Labels,
			Tags:           e.Tags,
			ContentText:    e.ContentText,
			Embedding:      e.Embedding,
		}
		if m, _ := structpb.NewStruct(e.Metadata); m != nil {
			pb.Metadata = m
		}
		if m, _ := structpb.NewStruct(e.RawPayload); m != nil {
			pb.RawPayload = m
		}
		if m, _ := structpb.NewStruct(e.RawMetadata); m != nil {
			pb.RawMetadata = m
		}
		req.Entries = append(req.Entries, pb)
	}
	_, err := c.grpcCli.UpsertEntries(ctx, req)
	return err
}

// DeleteByArtifact forwards to gRPC; useful for cleanup.
func (c *vectorClient) DeleteByArtifact(ctx context.Context, tenantID, artifactID, runID string) error {
	if c == nil || c.grpcCli == nil {
		return fmt.Errorf("vector client not initialized")
	}
	_, err := c.grpcCli.DeleteByArtifact(ctx, &vectorpb.DeleteByArtifactRequest{
		TenantId:   tenantID,
		ArtifactId: artifactID,
		RunId:      runID,
	})
	return err
}

// ListEntries uses pgvector fallback until gRPC exposes listing.
func (c *vectorClient) ListEntries(filter vectorstore.QueryFilter, limit int) ([]vectorstore.Entry, error) {
	if c == nil || c.grpcCli == nil {
		return nil, fmt.Errorf("vector client not initialized")
	}
	req := &vectorpb.ListEntriesRequest{
		TenantId:       filter.TenantID,
		ProjectId:      filter.ProjectID,
		ProfileIds:     filter.ProfileIDs,
		SourceFamily:   filter.SourceFamily,
		ArtifactId:     filter.ArtifactID,
		RunId:          filter.RunID,
		SinkEndpointId: filter.SinkEndpointID,
		DatasetSlug:    filter.DatasetSlug,
		EntityKinds:    filter.EntityKinds,
		Labels:         filter.Labels,
		Tags:           filter.Tags,
		Limit:          int32(limit),
	}
	resp, err := c.grpcCli.ListEntries(context.Background(), req)
	if err != nil {
		return nil, err
	}
	out := make([]vectorstore.Entry, 0, len(resp.GetEntries()))
	for _, e := range resp.GetEntries() {
		out = append(out, vectorstore.Entry{
			TenantID:       e.GetTenantId(),
			ProjectID:      e.GetProjectId(),
			ProfileID:      e.GetProfileId(),
			NodeID:         e.GetNodeId(),
			SourceFamily:   e.GetSourceFamily(),
			ArtifactID:     e.GetArtifactId(),
			RunID:          e.GetRunId(),
			SinkEndpointID: e.GetSinkEndpointId(),
			DatasetSlug:    e.GetDatasetSlug(),
			EntityKind:     e.GetEntityKind(),
			Labels:         e.GetLabels(),
			Tags:           e.GetTags(),
			ContentText:    e.GetContentText(),
			Metadata:       e.GetMetadata().AsMap(),
			RawPayload:     e.GetRawPayload().AsMap(),
			RawMetadata:    e.GetRawMetadata().AsMap(),
			Embedding:      e.GetEmbedding(),
			UpdatedAt:      nil,
		})
	}
	return out, nil
}

// helper to log with activity logger.
func logVectorWarning(ctx context.Context, msg string, err error) {
	activity.GetLogger(ctx).Warn(msg, "err", err)
}

// touchUpdatedAt ensures UpdatedAt is set to now when missing.
func touchUpdatedAt(entries []vectorstore.Entry) []vectorstore.Entry {
	now := time.Now().UTC()
	for i := range entries {
		if entries[i].UpdatedAt == nil {
			entries[i].UpdatedAt = &now
		}
	}
	return entries
}
