package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"

	"github.com/nucleus/store-core/gen/go/kvpb"
	"github.com/nucleus/store-core/gen/go/logpb"
	"github.com/nucleus/store-core/gen/go/signalpb"
	"github.com/nucleus/store-core/gen/go/vectorpb"
	"github.com/nucleus/store-core/pkg/kvstore"
	"github.com/nucleus/store-core/pkg/logstore"
	"github.com/nucleus/store-core/pkg/signalstore"
	"github.com/nucleus/store-core/pkg/vectorstore"
)

type kvServer struct {
	kvpb.UnimplementedKVServiceServer
	store kvstore.Store
}

func (s *kvServer) Get(ctx context.Context, req *kvpb.GetRequest) (*kvpb.GetResponse, error) {
	key := scopedKey(req.GetKey())
	parts := strings.SplitN(key, "|", 3)
	if len(parts) != 3 {
		return nil, status.Error(codes.InvalidArgument, "bad key")
	}
	rec, err := s.store.Get(ctx, parts[0], parts[1], parts[2])
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get: %v", err)
	}
	if rec == nil {
		return nil, status.Error(codes.NotFound, "not found")
	}
	return &kvpb.GetResponse{Value: rec.Value, Version: rec.Version, ContentType: ""}, nil
}

func (s *kvServer) Put(ctx context.Context, req *kvpb.PutRequest) (*kvpb.PutResponse, error) {
	key := scopedKey(req.GetKey())
	parts := strings.SplitN(key, "|", 3)
	if len(parts) != 3 {
		return nil, status.Error(codes.InvalidArgument, "bad key")
	}
	version, err := s.store.Put(ctx, kvstore.Record{
		TenantID:  parts[0],
		ProjectID: parts[1],
		Key:       parts[2],
		Value:     req.GetValue(),
	}, 0)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "put: %v", err)
	}
	return &kvpb.PutResponse{Version: version}, nil
}

func (s *kvServer) Delete(ctx context.Context, req *kvpb.DeleteRequest) (*kvpb.DeleteResponse, error) {
	key := scopedKey(req.GetKey())
	parts := strings.SplitN(key, "|", 3)
	if len(parts) != 3 {
		return nil, status.Error(codes.InvalidArgument, "bad key")
	}
	_, err := s.store.Delete(ctx, parts[0], parts[1], parts[2], 0)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete: %v", err)
	}
	return &kvpb.DeleteResponse{}, nil
}

func (s *kvServer) List(ctx context.Context, req *kvpb.ListRequest) (*kvpb.ListResponse, error) {
	prefix := scopedPrefix(req.GetTenantId(), req.GetProjectId(), req.GetPrefix())
	keys, err := s.store.ListKeys(ctx, req.GetTenantId(), req.GetProjectId(), req.GetPrefix(), int(req.GetLimit()))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list: %v", err)
	}
	resp := &kvpb.ListResponse{}
	for _, k := range keys {
		resp.Entries = append(resp.Entries, &kvpb.ListEntry{Key: prefix + k, Version: 0})
	}
	return resp, nil
}

type logServer struct {
	logpb.UnimplementedLogServiceServer
	store logstore.Store
}

type vectorServer struct {
	vectorpb.UnimplementedVectorServiceServer
	store vectorstore.Store
}

type signalServer struct {
	signalpb.UnimplementedSignalServiceServer
	store *signalstore.Store
}

func main() {
	addr := ":9099"
	kv, err := kvstore.NewPostgresStore()
	if err != nil {
		log.Fatalf("kv init: %v", err)
	}
	ls, err := initLogStore()
	if err != nil {
		log.Fatalf("logstore init: %v", err)
	}
	vs, vinitErr := initVectorStore()
	if vinitErr != nil {
		log.Printf("vectorstore init failed (vector service will be disabled): %v", vinitErr)
	}
	ss, sinitErr := signalstore.NewFromEnv()
	if sinitErr != nil {
		log.Printf("signalstore init failed (signal service will be disabled): %v", sinitErr)
	}
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	grpcServer := grpc.NewServer()
	kvpb.RegisterKVServiceServer(grpcServer, &kvServer{store: kv})
	logpb.RegisterLogServiceServer(grpcServer, &logServer{store: ls})
	if vs != nil {
		vectorpb.RegisterVectorServiceServer(grpcServer, vectorstore.NewGRPCServer(vs))
	}
	if ss != nil {
		signalpb.RegisterSignalServiceServer(grpcServer, signalstore.NewGRPCServer(ss))
	}
	healthSrv := health.NewServer()
	healthSrv.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(grpcServer, healthSrv)
	log.Printf("store-core gRPC listening on %s", addr)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func scopedKey(k *kvpb.ScopedKey) string {
	if k == nil {
		return ""
	}
	return k.GetTenantId() + "|" + k.GetProjectId() + "|" + k.GetKey()
}

func scopedPrefix(tenant, project, prefix string) string {
	return tenant + "|" + project + "|" + prefix
}

func initLogStore() (logstore.Store, error) {
	gs, err := logstore.NewGatewayStoreFromEnv()
	if err != nil {
		return nil, err
	}
	return gs, nil
}

func initVectorStore() (vectorstore.Store, error) {
	dsn := getEnv("VECTOR_DATABASE_URL", "")
	if dsn == "" {
		dsn = getEnv("DATABASE_URL", "")
	}
	if dsn == "" {
		return nil, fmt.Errorf("VECTOR_DATABASE_URL or DATABASE_URL required for vector store")
	}
	dim := 1536
	if v := getEnv("VECTOR_DIMENSION", ""); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			dim = parsed
		}
	}
	return vectorstore.NewPgVectorStore(dsn, dim)
}

func getEnv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// Log service
func (s *logServer) Append(ctx context.Context, req *logpb.AppendLogRequest) (*logpb.AppendLogResponse, error) {
	scope := req.GetScope()
	table := scope.GetStream()
	if err := s.store.CreateTable(ctx, table); err != nil {
		return nil, status.Errorf(codes.Internal, "log create: %v", err)
	}
	records := []logstore.Record{{
		RunID:       scope.GetStream(),
		DatasetSlug: scope.GetStream(),
		Op:          "append",
		Kind:        req.GetContentType(),
		ID:          "",
		Hash:        "",
		Seq:         0,
		At:          "",
	}}
	path, err := s.store.Append(ctx, table, scope.GetStream(), records)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "log append: %v", err)
	}
	return &logpb.AppendLogResponse{Offset: path}, nil
}

func (s *logServer) List(ctx context.Context, req *logpb.ListLogRequest) (*logpb.ListLogResponse, error) {
	scope := req.GetScope()
	table := scope.GetStream()
	prefix := table
	paths, err := s.store.ListPaths(ctx, prefix)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "log list: %v", err)
	}
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 100
	}
	start := 0
	if off := req.GetStartOffset(); off != "" {
		for i, p := range paths {
			if p == off {
				start = i
				break
			}
		}
	}
	end := start + limit
	if end > len(paths) {
		end = len(paths)
	}
	resp := &logpb.ListLogResponse{}
	for _, p := range paths[start:end] {
		resp.Entries = append(resp.Entries, &logpb.LogEntry{
			Offset:      p,
			Payload:     nil,
			ContentType: "",
		})
	}
	return resp, nil
}
