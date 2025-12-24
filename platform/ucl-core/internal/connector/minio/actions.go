package minio

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Ensure Endpoint implements ActionEndpoint for object/minio control-plane actions.
var _ endpoint.ActionEndpoint = (*Endpoint)(nil)

var minioActions = []*endpoint.ActionDescriptor{
	{
		ID:          "object.minio.ensure_bucket",
		Name:        "Ensure bucket",
		Description: "Create the bucket if it does not exist",
		Category:    "create",
	},
	{
		ID:          "object.minio.put_object",
		Name:        "Put object",
		Description: "Write an object (bytes) to a bucket/key",
		Category:    "create",
	},
	{
		ID:          "object.minio.get_object",
		Name:        "Get object",
		Description: "Read an object from a bucket/key",
		Category:    "read",
	},
	{
		ID:          "object.minio.list_prefix",
		Name:        "List prefix",
		Description: "List all keys under a prefix",
		Category:    "read",
	},
	{
		ID:          "object.minio.delete_object",
		Name:        "Delete object",
		Description: "Delete an object if it exists",
		Category:    "delete",
	},
}

var minioActionSchemas = map[string]*endpoint.ActionSchema{
	"object.minio.ensure_bucket": {
		ActionID: "object.minio.ensure_bucket",
		InputFields: []*endpoint.ActionField{
			{Name: "bucket", Label: "Bucket", DataType: "string", Required: true, Description: "Bucket name"},
		},
	},
	"object.minio.put_object": {
		ActionID: "object.minio.put_object",
		InputFields: []*endpoint.ActionField{
			{Name: "bucket", Label: "Bucket", DataType: "string", Required: true, Description: "Bucket name"},
			{Name: "key", Label: "Key", DataType: "string", Required: true, Description: "Object key/path"},
			{Name: "data", Label: "Data", DataType: "bytes", Required: true, Description: "Raw bytes or base64 string"},
			{Name: "base64", Label: "Base64 encoded", DataType: "boolean", Required: false, Description: "Set true when data is base64 string"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "bytesWritten", Label: "Bytes written", DataType: "integer"},
		},
	},
	"object.minio.get_object": {
		ActionID: "object.minio.get_object",
		InputFields: []*endpoint.ActionField{
			{Name: "bucket", Label: "Bucket", DataType: "string", Required: true, Description: "Bucket name"},
			{Name: "key", Label: "Key", DataType: "string", Required: true, Description: "Object key/path"},
			{Name: "encodeBase64", Label: "Return base64", DataType: "boolean", Required: false, Description: "Return payload encoded as base64"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "data", Label: "Data", DataType: "bytes", Description: "Raw or base64 string payload"},
			{Name: "bytesRead", Label: "Bytes read", DataType: "integer"},
		},
	},
	"object.minio.list_prefix": {
		ActionID: "object.minio.list_prefix",
		InputFields: []*endpoint.ActionField{
			{Name: "bucket", Label: "Bucket", DataType: "string", Required: true, Description: "Bucket name"},
			{Name: "prefix", Label: "Prefix", DataType: "string", Required: false, Description: "Prefix to list"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "keys", Label: "Keys", DataType: "array"},
		},
	},
	"object.minio.delete_object": {
		ActionID: "object.minio.delete_object",
		InputFields: []*endpoint.ActionField{
			{Name: "bucket", Label: "Bucket", DataType: "string", Required: true, Description: "Bucket name"},
			{Name: "key", Label: "Key", DataType: "string", Required: true, Description: "Object key/path"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "deleted", Label: "Deleted", DataType: "boolean"},
		},
	},
}

func init() {
	endpoint.RegisterActions("object.minio", minioActions)
}

// ListActions returns available MinIO actions.
func (e *Endpoint) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return minioActions, nil
}

// GetActionSchema returns the schema for a specific action.
func (e *Endpoint) GetActionSchema(ctx context.Context, actionID string) (*endpoint.ActionSchema, error) {
	schema, ok := minioActionSchemas[actionID]
	if !ok {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
	return schema, nil
}

// ExecuteAction executes the given action against the configured object store.
func (e *Endpoint) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	switch req.ActionID {
	case "object.minio.ensure_bucket":
		bucket := fmt.Sprintf("%v", req.Parameters["bucket"])
		if err := e.store.EnsureBucket(ctx, bucket); err != nil {
			return nil, err
		}
		return &endpoint.ActionResult{Success: true, Data: map[string]any{"bucket": bucket}}, nil

	case "object.minio.put_object":
		bucket := fmt.Sprintf("%v", req.Parameters["bucket"])
		key := fmt.Sprintf("%v", req.Parameters["key"])
		dataBytes, err := extractBytes(req.Parameters["data"], req.Parameters["base64"])
		if err != nil {
			return nil, err
		}
		if err := e.store.PutObject(ctx, bucket, key, dataBytes); err != nil {
			return nil, err
		}
		return &endpoint.ActionResult{
			Success: true,
			Data:    map[string]any{"bucket": bucket, "key": key, "bytesWritten": len(dataBytes)},
		}, nil

	case "object.minio.get_object":
		bucket := fmt.Sprintf("%v", req.Parameters["bucket"])
		key := fmt.Sprintf("%v", req.Parameters["key"])
		encodeBase64 := false
		if v, ok := req.Parameters["encodeBase64"].(bool); ok {
			encodeBase64 = v
		}
		data, err := e.store.GetObject(ctx, bucket, key)
		if err != nil {
			return nil, err
		}
		resp := map[string]any{
			"bucket":    bucket,
			"key":       key,
			"bytesRead": len(data),
		}
		if encodeBase64 {
			resp["data"] = base64.StdEncoding.EncodeToString(data)
		} else {
			resp["data"] = data
		}
		return &endpoint.ActionResult{Success: true, Data: resp}, nil

	case "object.minio.list_prefix":
		bucket := fmt.Sprintf("%v", req.Parameters["bucket"])
		prefix := ""
		if v, ok := req.Parameters["prefix"].(string); ok {
			prefix = v
		}
		keys, err := e.store.ListPrefix(ctx, bucket, prefix)
		if err != nil {
			return nil, err
		}
		return &endpoint.ActionResult{
			Success: true,
			Data:    map[string]any{"bucket": bucket, "prefix": prefix, "keys": keys},
		}, nil

	case "object.minio.delete_object":
		bucket := fmt.Sprintf("%v", req.Parameters["bucket"])
		key := fmt.Sprintf("%v", req.Parameters["key"])
		if err := e.store.DeleteObject(ctx, bucket, key); err != nil {
			return nil, err
		}
		return &endpoint.ActionResult{
			Success: true,
			Data:    map[string]any{"bucket": bucket, "key": key, "deleted": true},
		}, nil
	default:
		return nil, fmt.Errorf("unknown action: %s", req.ActionID)
	}
}

func extractBytes(raw any, base64Flag any) ([]byte, error) {
	if raw == nil {
		return nil, fmt.Errorf("data is required")
	}
	if b, ok := raw.([]byte); ok {
		return b, nil
	}
	str := fmt.Sprintf("%v", raw)
	if v, ok := base64Flag.(bool); ok && v {
		return base64.StdEncoding.DecodeString(str)
	}
	return []byte(str), nil
}
