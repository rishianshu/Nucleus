package tests

import (
	"context"
	"testing"

	"github.com/nucleus/ucl-core/internal/connector/confluence"
	"github.com/nucleus/ucl-core/pkg/endpoint"
)

func TestConfluencePlannerDeterministic(t *testing.T) {
	cfg := &confluence.Config{
		BaseURL:   "https://example.atlassian.net",
		Email:     "user@example.com",
		APIToken:  "token",
		Spaces:    []string{"ENG", "DOC"},
		FetchSize: 30,
	}
	conn, err := confluence.New(cfg)
	if err != nil {
		t.Fatalf("failed to init connector: %v", err)
	}

	probe, err := conn.ProbeIngestion(context.Background(), &endpoint.ProbeRequest{DatasetID: "confluence.page"})
	if err != nil {
		t.Fatalf("ProbeIngestion failed: %v", err)
	}
	if len(probe.SliceKeys) != 2 {
		t.Fatalf("expected 2 slice keys, got %d", len(probe.SliceKeys))
	}

	req := &endpoint.PlanIngestionRequest{
		DatasetID: "confluence.page",
		PageLimit: 25,
		Probe:     probe,
	}

	plan1, err := conn.PlanIngestion(context.Background(), req)
	if err != nil {
		t.Fatalf("PlanIngestion failed: %v", err)
	}
	plan2, err := conn.PlanIngestion(context.Background(), req)
	if err != nil {
		t.Fatalf("PlanIngestion repeat failed: %v", err)
	}

	if len(plan1.Slices) != len(plan2.Slices) {
		t.Fatalf("plan slices length mismatch: %d vs %d", len(plan1.Slices), len(plan2.Slices))
	}

	expectedIDs := []string{"space-doc-page-1", "space-eng-page-1"}
	for i := range expectedIDs {
		if plan1.Slices[i].SliceID != expectedIDs[i] || plan2.Slices[i].SliceID != expectedIDs[i] {
			t.Fatalf("deterministic slice order failed: %v %v", plan1.Slices, plan2.Slices)
		}
		if plan1.Slices[i].Params["pageLimit"] != 25 {
			t.Fatalf("expected pageLimit=25 in params, got %v", plan1.Slices[i].Params["pageLimit"])
		}
	}
}
