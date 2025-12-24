package signalstore

import (
	"context"

	signalpb "github.com/nucleus/store-core/gen/go/signalpb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// GRPCServer implements SignalService backed by Store.
type GRPCServer struct {
	signalpb.UnimplementedSignalServiceServer
	store *Store
}

func NewGRPCServer(store *Store) *GRPCServer {
	return &GRPCServer{store: store}
}

func (s *GRPCServer) UpsertDefinition(ctx context.Context, req *signalpb.UpsertDefinitionRequest) (*signalpb.UpsertDefinitionResponse, error) {
	if req.GetDefinition() == nil {
		return nil, status.Error(codes.InvalidArgument, "definition is required")
	}
	def := fromProtoDef(req.GetDefinition())
	id, err := s.store.UpsertDefinition(ctx, def)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "upsert definition: %v", err)
	}
	return &signalpb.UpsertDefinitionResponse{Id: id}, nil
}

func (s *GRPCServer) UpsertInstance(ctx context.Context, req *signalpb.UpsertInstanceRequest) (*signalpb.UpsertInstanceResponse, error) {
	if req.GetInstance() == nil {
		return nil, status.Error(codes.InvalidArgument, "instance is required")
	}
	inst := fromProtoInst(req.GetInstance())
	if err := s.store.UpsertInstance(ctx, inst); err != nil {
		return nil, status.Errorf(codes.Internal, "upsert instance: %v", err)
	}
	return &signalpb.UpsertInstanceResponse{}, nil
}

func (s *GRPCServer) ListDefinitions(ctx context.Context, req *signalpb.ListDefinitionsRequest) (*signalpb.ListDefinitionsResponse, error) {
	defs, err := s.store.ListDefinitions(ctx, req.GetSourceFamily())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list definitions: %v", err)
	}
	resp := &signalpb.ListDefinitionsResponse{}
	for _, d := range defs {
		resp.Definitions = append(resp.Definitions, toProtoDef(d))
	}
	return resp, nil
}

func (s *GRPCServer) ListInstancesForDefinition(ctx context.Context, req *signalpb.ListInstancesForDefinitionRequest) (*signalpb.ListInstancesForDefinitionResponse, error) {
	if req.GetDefinitionId() == "" {
		return nil, status.Error(codes.InvalidArgument, "definition_id is required")
	}
	insts, err := s.store.ListInstancesForDefinition(ctx, req.GetDefinitionId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list instances: %v", err)
	}
	resp := &signalpb.ListInstancesForDefinitionResponse{}
	for _, i := range insts {
		resp.Instances = append(resp.Instances, toProtoInst(i))
	}
	return resp, nil
}

func (s *GRPCServer) UpdateInstanceStatus(ctx context.Context, req *signalpb.UpdateInstanceStatusRequest) (*signalpb.UpdateInstanceStatusResponse, error) {
	if req.GetDefinitionId() == "" || req.GetEntityRef() == "" {
		return nil, status.Error(codes.InvalidArgument, "definition_id and entity_ref are required")
	}
	if err := s.store.UpdateInstanceStatus(ctx, req.GetDefinitionId(), req.GetEntityRef(), req.GetStatus()); err != nil {
		return nil, status.Errorf(codes.Internal, "update instance: %v", err)
	}
	return &signalpb.UpdateInstanceStatusResponse{}, nil
}

func fromProtoDef(d *signalpb.Definition) Definition {
	return Definition{
		ID:             d.GetId(),
		Slug:           d.GetSlug(),
		Title:          d.GetTitle(),
		Description:    d.GetDescription(),
		Status:         d.GetStatus(),
		ImplMode:       d.GetImplMode(),
		SourceFamily:   d.GetSourceFamily(),
		EntityKind:     d.GetEntityKind(),
		Severity:       d.GetSeverity(),
		ProcessKind:    d.GetProcessKind(),
		PolicyKind:     d.GetPolicyKind(),
		Tags:           d.GetTags(),
		CDMModelID:     d.GetCdmModelId(),
		SurfaceHints:   structToAny(d.GetSurfaceHints()),
		Owner:          d.GetOwner(),
		DefinitionSpec: structToAny(d.GetDefinitionSpec()),
	}
}

func toProtoDef(d Definition) *signalpb.Definition {
	surface, _ := structpb.NewStruct(toMap(d.SurfaceHints))
	spec, _ := structpb.NewStruct(toMap(d.DefinitionSpec))
	return &signalpb.Definition{
		Id:             d.ID,
		Slug:           d.Slug,
		Title:          d.Title,
		Description:    d.Description,
		Status:         d.Status,
		ImplMode:       d.ImplMode,
		SourceFamily:   d.SourceFamily,
		EntityKind:     d.EntityKind,
		Severity:       d.Severity,
		ProcessKind:    d.ProcessKind,
		PolicyKind:     d.PolicyKind,
		Tags:           d.Tags,
		CdmModelId:     d.CDMModelID,
		SurfaceHints:   surface,
		Owner:          d.Owner,
		DefinitionSpec: spec,
	}
}

func fromProtoInst(i *signalpb.Instance) Instance {
	return Instance{
		ID:           i.GetId(),
		DefinitionID: i.GetDefinitionId(),
		Status:       i.GetStatus(),
		EntityRef:    i.GetEntityRef(),
		EntityKind:   i.GetEntityKind(),
		Severity:     i.GetSeverity(),
		Summary:      i.GetSummary(),
		Details:      structToAny(i.GetDetails()),
		SourceRunID:  i.GetSourceRunId(),
	}
}

func toProtoInst(i Instance) *signalpb.Instance {
	details, _ := structpb.NewStruct(toMap(i.Details))
	return &signalpb.Instance{
		Id:           i.ID,
		DefinitionId: i.DefinitionID,
		Status:       i.Status,
		EntityRef:    i.EntityRef,
		EntityKind:   i.EntityKind,
		Severity:     i.Severity,
		Summary:      i.Summary,
		Details:      details,
		SourceRunId:  i.SourceRunID,
	}
}

func structToAny(s *structpb.Struct) any {
	if s == nil {
		return nil
	}
	return s.AsMap()
}

func toMap(v any) map[string]any {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}
