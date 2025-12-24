package logstore

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	gatewayv1 "github.com/nucleus/store-core/gen/go/gatewayv1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
)

// GatewayStore uses the GatewayService actions to interact with an object store.
// Requires an endpoint that supports object.minio.* actions.
type GatewayStore struct {
	client     gatewayv1.GatewayServiceClient
	endpointID string
	bucket     string
	basePrefix string
}

// NewGatewayStoreFromEnv builds a Gateway-backed logstore.
// Env: LOGSTORE_ENDPOINT_ID (required), LOGSTORE_GATEWAY_ADDR (default localhost:50051),
// LOGSTORE_BUCKET (default logstore), LOGSTORE_PREFIX (default logs).
func NewGatewayStoreFromEnv() (*GatewayStore, error) {
	endpointID := getenv("LOGSTORE_ENDPOINT_ID", "")
	if endpointID == "" {
		return nil, fmt.Errorf("LOGSTORE_ENDPOINT_ID is required for gateway logstore")
	}
	addr := getenv("LOGSTORE_GATEWAY_ADDR", "localhost:50051")
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &GatewayStore{
		client:     gatewayv1.NewGatewayServiceClient(conn),
		endpointID: endpointID,
		bucket:     getenv("LOGSTORE_BUCKET", "logstore"),
		basePrefix: getenv("LOGSTORE_PREFIX", "logs"),
	}, nil
}

func (s *GatewayStore) CreateTable(ctx context.Context, table string) error {
	_, err := s.execute(ctx, "object.minio.ensure_bucket", map[string]any{
		"bucket": s.bucket,
	})
	if err != nil {
		return err
	}
	key := s.path(table, "._init")
	_, err = s.execute(ctx, "object.minio.put_object", map[string]any{
		"bucket": s.bucket,
		"key":    key,
		"data":   "init",
	})
	return err
}

func (s *GatewayStore) Append(ctx context.Context, table, runID string, records []Record) (string, error) {
	if len(records) == 0 {
		return "", nil
	}
	var buf bytes.Buffer
	for _, r := range records {
		line, _ := jsonMarshal(r)
		buf.Write(line)
		buf.WriteByte('\n')
	}
	key := s.path(table, fmt.Sprintf("%s-%d.jsonl", runID, time.Now().UnixNano()))
	_, err := s.execute(ctx, "object.minio.put_object", map[string]any{
		"bucket": s.bucket,
		"key":    key,
		"data":   base64.StdEncoding.EncodeToString(buf.Bytes()),
		"base64": true,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("minio://%s/%s", s.bucket, key), nil
}

func (s *GatewayStore) WriteSnapshot(ctx context.Context, table, runID string, snapshot []byte) (string, error) {
	key := s.path(table, fmt.Sprintf("%s.snapshot.json", runID))
	_, err := s.execute(ctx, "object.minio.put_object", map[string]any{
		"bucket": s.bucket,
		"key":    key,
		"data":   base64.StdEncoding.EncodeToString(snapshot),
		"base64": true,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("minio://%s/%s", s.bucket, key), nil
}

func (s *GatewayStore) Prune(ctx context.Context, table string, retentionDays int) error {
	if retentionDays <= 0 {
		return nil
	}
	prefix := strings.Trim(strings.Join([]string{s.basePrefix, table}, "/"), "/")
	resp, err := s.execute(ctx, "object.minio.list_prefix", map[string]any{
		"bucket": s.bucket,
		"prefix": prefix,
	})
	if err != nil {
		return err
	}
	keysAny, ok := resp["keys"].([]any)
	if !ok {
		return nil
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).UnixNano()
	for _, kv := range keysAny {
		key, ok := kv.(string)
		if !ok {
			continue
		}
		if shouldPrune(key, cutoff) {
			_, _ = s.execute(ctx, "object.minio.delete_object", map[string]any{
				"bucket": s.bucket,
				"key":    key,
			})
		}
	}
	return nil
}

func (s *GatewayStore) ListPaths(ctx context.Context, prefix string) ([]string, error) {
	resp, err := s.execute(ctx, "object.minio.list_prefix", map[string]any{
		"bucket": s.bucket,
		"prefix": strings.Trim(prefix, "/"),
	})
	if err != nil {
		return nil, err
	}
	keysAny, ok := resp["keys"].([]any)
	if !ok {
		return nil, nil
	}
	keys := make([]string, 0, len(keysAny))
	for _, kv := range keysAny {
		if k, ok := kv.(string); ok {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

func (s *GatewayStore) path(table, file string) string {
	return strings.Trim(strings.Join([]string{s.basePrefix, table, file}, "/"), "/")
}

func (s *GatewayStore) execute(ctx context.Context, action string, params map[string]any) (map[string]any, error) {
	pbParams, _ := structpb.NewStruct(params)
	resp, err := s.client.ExecuteAction(ctx, &gatewayv1.ExecuteActionRequest{
		EndpointId: s.endpointID,
		ActionName: action,
		Parameters: pbParams,
		Mode:       gatewayv1.ExecutionMode_EXECUTION_MODE_SYNC,
	})
	if err != nil {
		return nil, err
	}
	if resp.Result == nil {
		return map[string]any{}, nil
	}
	return resp.Result.AsMap(), nil
}

func shouldPrune(key string, cutoffNs int64) bool {
	if !(strings.HasSuffix(key, ".jsonl") || strings.HasSuffix(key, ".snapshot.json")) {
		return false
	}
	base := filepath.Base(key)
	tsStr := strings.TrimSuffix(base, ".jsonl")
	tsStr = strings.TrimSuffix(tsStr, ".snapshot.json")
	fields := strings.Split(tsStr, "-")
	if len(fields) < 2 {
		return false
	}
	if ns, err := strconv.ParseInt(fields[len(fields)-1], 10, 64); err == nil {
		return ns < cutoffNs
	}
	return false
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
