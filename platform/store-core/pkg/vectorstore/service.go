package vectorstore

import (
	"context"

	vectorpb "github.com/nucleus/store-core/gen/go/vectorpb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// GRPCServer implements vectorpb.VectorServiceServer backed by a Store.
type GRPCServer struct {
	vectorpb.UnimplementedVectorServiceServer
	store Store
}

func NewGRPCServer(store Store) *GRPCServer {
	return &GRPCServer{store: store}
}

func (s *GRPCServer) UpsertEntries(ctx context.Context, req *vectorpb.UpsertEntriesRequest) (*vectorpb.UpsertEntriesResponse, error) {
	if len(req.GetEntries()) == 0 {
		return &vectorpb.UpsertEntriesResponse{Upserted: 0}, nil
	}
	entries := make([]Entry, 0, len(req.GetEntries()))
	for _, e := range req.GetEntries() {
		entries = append(entries, entryFromProto(e))
	}
	if err := s.store.UpsertEntries(entries); err != nil {
		return nil, status.Errorf(codes.Internal, "upsert: %v", err)
	}
	return &vectorpb.UpsertEntriesResponse{Upserted: int32(len(entries))}, nil
}

func (s *GRPCServer) Search(ctx context.Context, req *vectorpb.SearchRequest) (*vectorpb.SearchResponse, error) {
	if len(req.GetEmbedding()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "embedding is required")
	}
	filter := QueryFilter{
		TenantID:       req.GetTenantId(),
		ProjectID:      req.GetProjectId(),
		ProfileIDs:     req.GetProfileIds(),
		SourceFamily:   req.GetSourceFamily(),
		ArtifactID:     req.GetArtifactId(),
		RunID:          req.GetRunId(),
		SinkEndpointID: req.GetSinkEndpointId(),
		DatasetSlug:    req.GetDatasetSlug(),
		EntityKinds:    req.GetEntityKinds(),
		Labels:         req.GetLabels(),
		Tags:           req.GetTags(),
	}
	results, err := s.store.Query(req.GetEmbedding(), filter, int(req.GetTopK()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "search: %v", err)
	}
	resp := &vectorpb.SearchResponse{}
	for _, r := range results {
		meta, _ := structpb.NewStruct(r.Metadata)
		resp.Hits = append(resp.Hits, &vectorpb.SearchHit{
			NodeId:      r.NodeID,
			ProfileId:   r.ProfileID,
			Score:       r.Score,
			ContentText: r.ContentText,
			Metadata:    meta,
		})
	}
	return resp, nil
}

func (s *GRPCServer) DeleteByArtifact(ctx context.Context, req *vectorpb.DeleteByArtifactRequest) (*vectorpb.DeleteByArtifactResponse, error) {
	if req.GetTenantId() == "" || req.GetArtifactId() == "" {
		return nil, status.Error(codes.InvalidArgument, "tenant_id and artifact_id are required")
	}
	if err := s.store.DeleteByArtifact(req.GetTenantId(), req.GetArtifactId(), req.GetRunId()); err != nil {
		return nil, status.Errorf(codes.Internal, "delete: %v", err)
	}
	return &vectorpb.DeleteByArtifactResponse{}, nil
}

func (s *GRPCServer) ListEntries(ctx context.Context, req *vectorpb.ListEntriesRequest) (*vectorpb.ListEntriesResponse, error) {
	filter := QueryFilter{
		TenantID:       req.GetTenantId(),
		ProjectID:      req.GetProjectId(),
		ProfileIDs:     req.GetProfileIds(),
		SourceFamily:   req.GetSourceFamily(),
		ArtifactID:     req.GetArtifactId(),
		RunID:          req.GetRunId(),
		SinkEndpointID: req.GetSinkEndpointId(),
		DatasetSlug:    req.GetDatasetSlug(),
		EntityKinds:    req.GetEntityKinds(),
		Labels:         req.GetLabels(),
		Tags:           req.GetTags(),
		Limit:          int(req.GetLimit()),
	}
	entries, err := s.store.ListEntries(filter, filter.Limit)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list: %v", err)
	}
	resp := &vectorpb.ListEntriesResponse{}
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
		resp.Entries = append(resp.Entries, pb)
	}
	return resp, nil
}

func entryFromProto(e *vectorpb.Entry) Entry {
	return Entry{
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
		Metadata:       structToMap(e.GetMetadata()),
		RawPayload:     structToMap(e.GetRawPayload()),
		RawMetadata:    structToMap(e.GetRawMetadata()),
		Embedding:      e.GetEmbedding(),
	}
}

func structToMap(s *structpb.Struct) map[string]any {
	if s == nil {
		return nil
	}
	return s.AsMap()
}
