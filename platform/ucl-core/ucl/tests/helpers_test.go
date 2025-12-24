package tests

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nucleus/ucl-core/pkg/endpoint"
)

type stubIterator struct {
	count int
	idx   int
}

func (it *stubIterator) Next() bool {
	if it.idx >= it.count {
		return false
	}
	it.idx++
	return true
}

func (it *stubIterator) Value() endpoint.Record {
	return endpoint.Record{
		"id": fmt.Sprintf("rec-%d", it.idx),
	}
}

func (it *stubIterator) Err() error   { return nil }
func (it *stubIterator) Close() error { return nil }

type stubSource struct {
	templateID string
	datasetID  string
	records    int
	slices     int
	failErr    error
}

func (s *stubSource) ID() string { return s.templateID }

func (s *stubSource) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	return &endpoint.ValidationResult{Valid: true}, nil
}

func (s *stubSource) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:    true,
		SupportsPreview: true,
	}
}

func (s *stubSource) GetDescriptor() *endpoint.Descriptor {
	return &endpoint.Descriptor{ID: s.templateID}
}

func (s *stubSource) Close() error { return nil }

func (s *stubSource) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	return []*endpoint.Dataset{{ID: s.datasetID, Name: s.datasetID}}, nil
}

func (s *stubSource) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	return &endpoint.Schema{Fields: []*endpoint.FieldDefinition{}}, nil
}

func (s *stubSource) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if s.failErr != nil {
		return nil, s.failErr
	}
	return &stubIterator{count: s.records}, nil
}

func (s *stubSource) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	return nil, nil
}

func (s *stubSource) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	sliceCount := s.slices
	if sliceCount <= 0 {
		sliceCount = 1
	}
	slices := make([]*endpoint.IngestionSlice, 0, sliceCount)
	for i := 0; i < sliceCount; i++ {
		slices = append(slices, &endpoint.IngestionSlice{
			SliceID:  fmt.Sprintf("slice-%d", i),
			Sequence: i,
		})
	}
	return &endpoint.IngestionPlan{
		DatasetID: req.DatasetID,
		Strategy:  req.Strategy,
		Slices:    slices,
	}, nil
}

func (s *stubSource) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if s.failErr != nil {
		return nil, s.failErr
	}
	perSlice := s.records
	if s.slices > 0 {
		perSlice = (s.records + s.slices - 1) / s.slices
	}
	return &stubIterator{count: perSlice}, nil
}

func (s *stubSource) CountBetween(ctx context.Context, datasetID, lower, upper string) (int64, error) {
	return int64(s.records), nil
}

func registerStubEndpoint(templateID string, records, slices int, failErr error) string {
	id := fmt.Sprintf("%s-%d", templateID, time.Now().UnixNano())
	endpoint.Register(id, func(config map[string]any) (endpoint.Endpoint, error) {
		dataset := fmt.Sprint(config["dataset_id"])
		if dataset == "" {
			if v, ok := config["datasetId"].(string); ok && v != "" {
				dataset = v
			}
		}
		if dataset == "" {
			dataset = strings.ReplaceAll(id, ".", "_")
		}
		return &stubSource{
			templateID: id,
			datasetID:  dataset,
			records:    records,
			slices:     slices,
			failErr:    failErr,
		}, nil
	})
	return id
}

func requireLocalMinioEnv(t *testing.T) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("MINIO_ENDPOINT", "file://"+root)
	t.Setenv("MINIO_ACCESS_KEY", "minioadmin")
	t.Setenv("MINIO_SECRET_KEY", "minioadmin")
	t.Setenv("MINIO_BUCKET", "ucl-staging")
	t.Setenv("MINIO_STAGE_PREFIX", "sink")
	t.Setenv("TENANT_ID", "tenant-default")
}

func clearMinioEnv(t *testing.T) {
	t.Helper()
	vars := []string{
		"MINIO_ENDPOINT",
		"MINIO_ACCESS_KEY",
		"MINIO_SECRET_KEY",
		"MINIO_BUCKET",
		"MINIO_STAGE_PREFIX",
		"TENANT_ID",
	}
	for _, key := range vars {
		t.Setenv(key, "")
	}
}
