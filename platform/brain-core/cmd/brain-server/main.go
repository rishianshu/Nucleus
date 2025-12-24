package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"

	brainpb "github.com/nucleus/brain-core/gen/go/brainpb"
)

type brainServer struct {
	db *sql.DB
	brainpb.UnimplementedBrainServiceServer
}

func main() {
	addr := env("BRAIN_GRPC_ADDR", ":9098")
	metadataDSN := env("METADATA_DATABASE_URL", "")
	if metadataDSN == "" {
		log.Fatalf("METADATA_DATABASE_URL is required")
	}

	db, err := sql.Open("pgx", metadataDSN)
	if err != nil {
		log.Fatalf("open metadata db: %v", err)
	}
	db.SetMaxIdleConns(2)
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen on %s: %v", addr, err)
	}

	grpcServer := grpc.NewServer()
	brainpb.RegisterBrainServiceServer(grpcServer, &brainServer{db: db})

	healthSrv := health.NewServer()
	healthSrv.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(grpcServer, healthSrv)

	log.Printf("brain-core gRPC listening on %s", addr)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve gRPC: %v", err)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func (s *brainServer) GetRunSummary(ctx context.Context, req *brainpb.RunSummaryRequest) (*brainpb.RunSummaryResponse, error) {
	if s.db == nil {
		return nil, status.Error(codes.Unavailable, "metadata db unavailable")
	}
	if req.GetArtifactId() == "" {
		return nil, status.Error(codes.InvalidArgument, "artifact_id is required")
	}

	row := s.db.QueryRowContext(ctx, `
SELECT tenant_id, source_family, sink_endpoint_id, index_counters
FROM metadata.materialized_artifacts
WHERE id=$1`, req.GetArtifactId())

	var tenantID, sourceFamily, sinkID sql.NullString
	var countersBytes []byte
	if err := row.Scan(&tenantID, &sourceFamily, &sinkID, &countersBytes); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, status.Errorf(codes.NotFound, "artifact %s not found", req.GetArtifactId())
		}
		return nil, status.Errorf(codes.Internal, "query summary: %v", err)
	}

	resp := &brainpb.RunSummaryResponse{
		ArtifactId:     req.GetArtifactId(),
		TenantId:       tenantID.String,
		SourceFamily:   sourceFamily.String,
		SinkEndpointId: sinkID.String,
	}

	if len(countersBytes) > 0 {
		var counters map[string]any
		if err := json.Unmarshal(countersBytes, &counters); err == nil {
			if v, ok := counters["versionHash"].(string); ok {
				resp.VersionHash = v
			}
			if v, ok := counters["logEventsPath"].(string); ok {
				resp.LogEventsPath = v
			}
			if v, ok := counters["logSnapshotPath"].(string); ok {
				resp.LogSnapshotPath = v
			}
			if v, ok := counters["nodesTouched"].(float64); ok {
				resp.NodesTouched = int64(v)
			}
			if v, ok := counters["edgesTouched"].(float64); ok {
				resp.EdgesTouched = int64(v)
			}
			if v, ok := counters["cacheHits"].(float64); ok {
				resp.CacheHits = int64(v)
			}
		}
	}

	return resp, nil
}

func (s *brainServer) DiffRunSummaries(ctx context.Context, req *brainpb.DiffRunSummariesRequest) (*brainpb.DiffRunSummariesResponse, error) {
	if req.GetLeftArtifactId() == "" || req.GetRightArtifactId() == "" {
		return nil, status.Error(codes.InvalidArgument, "left_artifact_id and right_artifact_id are required")
	}

	left, err := s.GetRunSummary(ctx, &brainpb.RunSummaryRequest{ArtifactId: req.GetLeftArtifactId()})
	if err != nil {
		return nil, fmt.Errorf("left summary: %w", err)
	}
	right, err := s.GetRunSummary(ctx, &brainpb.RunSummaryRequest{ArtifactId: req.GetRightArtifactId()})
	if err != nil {
		return nil, fmt.Errorf("right summary: %w", err)
	}

	versionEqual := left.GetVersionHash() != "" && left.GetVersionHash() == right.GetVersionHash()
	logPath := right.GetLogEventsPath()
	if logPath == "" {
		logPath = left.GetLogEventsPath()
	}

	notes := "versionHash differs; replay logs if needed"
	if versionEqual {
		notes = "versionHash matches; no replay needed"
	}

	return &brainpb.DiffRunSummariesResponse{
		Left:          left,
		Right:         right,
		VersionEqual:  versionEqual,
		Notes:         notes,
		LogEventsPath: logPath,
	}, nil
}
