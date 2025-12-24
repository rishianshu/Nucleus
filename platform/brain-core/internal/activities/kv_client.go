package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"google.golang.org/grpc"

	kvpb "github.com/nucleus/ucl-core/gen/go/proto/github.com/nucleus/ucl-core/pkg/kvpb"
)

var (
	kvOnce   sync.Once
	kvClient kvpb.KVServiceClient
	kvErr    error
)

func getKVClient() (kvpb.KVServiceClient, error) {
	kvOnce.Do(func() {
		addr := os.Getenv("KV_GRPC_ADDR")
		if addr == "" {
			addr = os.Getenv("UCL_GRPC_ADDR")
		}
		if addr == "" {
			addr = os.Getenv("VECTOR_GRPC_ADDR")
		}
		if addr == "" {
			addr = os.Getenv("STORE_VECTOR_GRPC_ADDR")
		}
		if addr == "" {
			addr = "localhost:9099"
		}
		conn, err := grpc.Dial(addr, grpc.WithInsecure(), grpc.WithBlock(), grpc.WithTimeout(5*time.Second))
		if err != nil {
			kvErr = err
			return
		}
		kvClient = kvpb.NewKVServiceClient(conn)
	})
	return kvClient, kvErr
}

func loadCheckpointKV(ctx context.Context, tenantID, projectID, key string) (map[string]any, error) {
	client, err := getKVClient()
	if err != nil {
		return nil, err
	}
	resp, err := client.Get(ctx, &kvpb.GetRequest{
		Scope: &kvpb.Scope{TenantId: tenantID, ProjectId: projectID},
		Key:   key,
	})
	if err != nil {
		return nil, err
	}
	if !resp.GetFound() {
		return nil, nil
	}
	var m map[string]any
	if len(resp.GetValue()) > 0 {
		if err := json.Unmarshal(resp.GetValue(), &m); err != nil {
			return nil, err
		}
	}
	return m, nil
}

func saveCheckpointKV(ctx context.Context, tenantID, projectID, key string, checkpoint map[string]any) error {
	client, err := getKVClient()
	if err != nil {
		return err
	}
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	_, err = client.Put(ctx, &kvpb.PutRequest{
		Scope: &kvpb.Scope{TenantId: tenantID, ProjectId: projectID},
		Key:   key,
		Value: data,
	})
	return err
}

func makeCheckpointKey(profileID, datasetSlug string) string {
	return fmt.Sprintf("indexer:%s:%s", profileID, datasetSlug)
}
