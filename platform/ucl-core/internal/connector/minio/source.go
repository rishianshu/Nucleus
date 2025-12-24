package minio

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// datasetIterator is a simple in-memory iterator over endpoint records.
type datasetIterator struct {
	records []endpoint.Record
	idx     int
	err     error
}

func (it *datasetIterator) Next() bool {
	if it.err != nil {
		return false
	}
	if it.idx >= len(it.records) {
		return false
	}
	it.idx++
	return true
}

func (it *datasetIterator) Value() endpoint.Record {
	if it.idx == 0 || it.idx > len(it.records) {
		return nil
	}
	return it.records[it.idx-1]
}

func (it *datasetIterator) Err() error  { return it.err }
func (it *datasetIterator) Close() error { return nil }

// ListDatasets discovers datasets by folder convention: basePrefix/tenant/{dataset}/dt=.../run=...
func (e *Endpoint) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	prefix := joinPath(e.config.BasePrefix, e.config.TenantID)
	keys, err := e.store.ListPrefix(ctx, e.config.Bucket, prefix)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	for _, key := range keys {
		parts := strings.Split(strings.TrimPrefix(key, prefix+"/"), "/")
		if len(parts) < 1 || parts[0] == "" {
			continue
		}
		dataset := parts[0]
		// Skip obvious hive partitions
		if strings.HasPrefix(dataset, "dt=") || strings.HasPrefix(dataset, "run=") {
			continue
		}
		seen[dataset] = struct{}{}
	}
	var datasets []*endpoint.Dataset
	for ds := range seen {
		datasets = append(datasets, &endpoint.Dataset{
			ID:                  ds,
			Name:                ds,
			Kind:                "table",
			SupportsIncremental: true,
		})
	}
	sort.Slice(datasets, func(i, j int) bool { return datasets[i].ID < datasets[j].ID })
	return datasets, nil
}

// GetSchema returns nil; schema should come from orchestrator/registry.
func (e *Endpoint) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	_ = ctx
	_ = datasetID
	return nil, nil
}

// Read streams envelopes from hive-partitioned JSONL.GZ parts.
// Checkpoint convention: map[string]any{"cursor": lastKey, "runId": lastRunId}
func (e *Endpoint) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	if req == nil || strings.TrimSpace(req.DatasetID) == "" {
		return nil, fmt.Errorf("datasetId is required")
	}
	prefix := joinPath(e.config.BasePrefix, e.config.TenantID, req.DatasetID)
	keys, err := e.store.ListPrefix(ctx, e.config.Bucket, prefix)
	if err != nil {
		return nil, err
	}
	sort.Strings(keys)

	runFilter := ""
	if req.Checkpoint != nil {
		if v, ok := req.Checkpoint["runId"].(string); ok {
			runFilter = strings.TrimSpace(v)
		}
	}
	lastCursor := ""
	if req.Checkpoint != nil {
		if v, ok := req.Checkpoint["cursor"].(string); ok {
			lastCursor = strings.TrimSpace(v)
		}
	}

	var records []endpoint.Record
	limit := req.Limit
	if limit <= 0 {
		limit = int64(len(keys)) * 100 // rough upper bound
	}

	for _, key := range keys {
		if lastCursor != "" && key <= lastCursor {
			continue
		}
		// Expect keys like base/tenant/dataset/dt=.../run=.../part-xxxx.jsonl.gz
		if !strings.Contains(key, "/run=") || !strings.HasSuffix(key, ".jsonl.gz") {
			continue
		}
		if runFilter != "" && !strings.Contains(key, "/run="+runFilter) {
			continue
		}

		data, getErr := e.store.GetObject(ctx, e.config.Bucket, key)
		if getErr != nil {
			return nil, getErr
		}
		envs, decErr := decodeEnvelopes(bytes.NewReader(data))
		if decErr != nil {
			return nil, decErr
		}
		for _, env := range envs {
			runID := extractRunID(key)
			rec := map[string]any{
				"recordKind": env.RecordKind,
				"entityKind": env.EntityKind,
				"payload":    env.Payload,
				"source":     env.Source,
				"tenantId":   env.TenantID,
				"projectKey": env.ProjectKey,
				"observedAt": env.ObservedAt,
				"objectKey":  key,
				"runId":      runID,
			}
			records = append(records, rec)
			if int64(len(records)) >= limit {
				return &datasetIterator{records: records}, nil
			}
		}
	}

	return &datasetIterator{records: records}, nil
}

// extractRunID parses run=<id> from a key, if present.
func extractRunID(key string) string {
	parts := strings.Split(key, "/")
	for _, part := range parts {
		if strings.HasPrefix(part, "run=") {
			return strings.TrimPrefix(part, "run=")
		}
	}
	return ""
}
