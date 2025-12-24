package kv

import (
	"context"

	kvpb "github.com/nucleus/ucl-core/gen/go/proto/github.com/nucleus/ucl-core/pkg/kvpb"
	"github.com/nucleus/store-core/pkg/kvstore"
)

type Service struct {
	store kvstore.Store
	kvpb.UnimplementedKVServiceServer
}

func NewService(store kvstore.Store) *Service {
	return &Service{store: store}
}

func (s *Service) Put(ctx context.Context, req *kvpb.PutRequest) (*kvpb.PutResponse, error) {
	scope := normalizeScope(req.GetScope())
	rec := kvstore.Record{
		TenantID:  scope.TenantID,
		ProjectID: scope.ProjectID,
		Key:       req.GetKey(),
		Value:     req.GetValue(),
	}
	version, err := s.store.Put(ctx, rec, req.GetExpectedVersion())
	if err != nil {
		return nil, err
	}
	return &kvpb.PutResponse{Version: version}, nil
}

func (s *Service) Get(ctx context.Context, req *kvpb.GetRequest) (*kvpb.GetResponse, error) {
	scope := normalizeScope(req.GetScope())
	rec, err := s.store.Get(ctx, scope.TenantID, scope.ProjectID, req.GetKey())
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return &kvpb.GetResponse{Found: false}, nil
	}
	return &kvpb.GetResponse{
		Value:   rec.Value,
		Version: rec.Version,
		Found:   true,
	}, nil
}

func (s *Service) Delete(ctx context.Context, req *kvpb.DeleteRequest) (*kvpb.DeleteResponse, error) {
	scope := normalizeScope(req.GetScope())
	ok, err := s.store.Delete(ctx, scope.TenantID, scope.ProjectID, req.GetKey(), req.GetExpectedVersion())
	if err != nil {
		return nil, err
	}
	return &kvpb.DeleteResponse{Deleted: ok}, nil
}

func (s *Service) ListKeys(ctx context.Context, req *kvpb.ListKeysRequest) (*kvpb.ListKeysResponse, error) {
	scope := normalizeScope(req.GetScope())
	keys, err := s.store.ListKeys(ctx, scope.TenantID, scope.ProjectID, req.GetPrefix(), int(req.GetLimit()))
	if err != nil {
		return nil, err
	}
	return &kvpb.ListKeysResponse{Keys: keys}, nil
}

type normalizedScope struct {
	TenantID  string
	ProjectID string
}

func normalizeScope(scope *kvpb.Scope) normalizedScope {
	tenant := "dev"
	project := "global"
	if scope != nil {
		if scope.GetTenantId() != "" {
			tenant = scope.GetTenantId()
		}
		if scope.GetProjectId() != "" {
			project = scope.GetProjectId()
		}
	}
	return normalizedScope{TenantID: tenant, ProjectID: project}
}
