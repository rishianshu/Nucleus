package activities

import (
	"context"
	"fmt"
)

// RunSummaryRequest fetches clustering/indexing summary for a materialized artifact.
type RunSummaryRequest struct {
	ArtifactID string `json:"artifactId"`
}

type RunSummaryResponse struct {
	ArtifactID      string `json:"artifactId"`
	TenantID        string `json:"tenantId"`
	SourceFamily    string `json:"sourceFamily"`
	SinkEndpointID  string `json:"sinkEndpointId"`
	VersionHash     string `json:"versionHash"`
	NodesTouched    int64  `json:"nodesTouched"`
	EdgesTouched    int64  `json:"edgesTouched"`
	CacheHits       int64  `json:"cacheHits"`
	LogEventsPath   string `json:"logEventsPath"`
	LogSnapshotPath string `json:"logSnapshotPath"`
}

// GetRunSummary returns registry counters/log paths for an artifact/run for UI/CLI consumption.
func (a *Activities) GetRunSummary(ctx context.Context, req RunSummaryRequest) (*RunSummaryResponse, error) {
	reg, err := newRegistryClient()
	if err != nil {
		return nil, err
	}
	defer reg.Close()
	sum, err := reg.getRunSummary(ctx, req.ArtifactID)
	if err != nil {
		return nil, err
	}
	if sum == nil {
		return nil, fmt.Errorf("artifact not found")
	}
	return &RunSummaryResponse{
		ArtifactID:      sum.ArtifactID,
		TenantID:        sum.TenantID,
		SourceFamily:    sum.SourceFamily,
		SinkEndpointID:  sum.SinkEndpointID,
		VersionHash:     sum.VersionHash,
		NodesTouched:    sum.NodesTouched,
		EdgesTouched:    sum.EdgesTouched,
		CacheHits:       sum.CacheHits,
		LogEventsPath:   sum.LogEventsPath,
		LogSnapshotPath: sum.LogSnapshotPath,
	}, nil
}
