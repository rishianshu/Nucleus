package tests

import (
	"context"
	"testing"

	"github.com/nucleus/ucl-core/internal/connector/jira"
	"github.com/nucleus/ucl-core/pkg/endpoint"
)

func TestJiraPlannerDeterministic(t *testing.T) {
	cfg := &jira.Config{
		BaseURL:   "https://example.atlassian.net",
		Email:     "user@example.com",
		APIToken:  "token",
		Projects:  []string{"OPS", "ENG"},
		FetchSize: 50,
	}
	conn, err := jira.New(cfg)
	if err != nil {
		t.Fatalf("failed to init connector: %v", err)
	}

	probe, err := conn.ProbeIngestion(context.Background(), &endpoint.ProbeRequest{DatasetID: "jira.issues"})
	if err != nil {
		t.Fatalf("ProbeIngestion failed: %v", err)
	}

	req := &endpoint.PlanIngestionRequest{
		DatasetID: "jira.issues",
		PageLimit: 40,
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

	if len(plan1.Slices) != 2 || len(plan2.Slices) != 2 {
		t.Fatalf("expected 2 slices, got %d and %d", len(plan1.Slices), len(plan2.Slices))
	}

	expectedIDs := []string{"project-eng-page-1", "project-ops-page-1"}
	for i := range expectedIDs {
		if plan1.Slices[i].SliceID != expectedIDs[i] || plan2.Slices[i].SliceID != expectedIDs[i] {
			t.Fatalf("deterministic slice order failed: %v %v", plan1.Slices, plan2.Slices)
		}
		if plan1.Slices[i].Params["projectKey"] == "" {
			t.Fatalf("expected projectKey param to be set")
		}
		if plan1.Slices[i].Params["pageLimit"] != 40 {
			t.Fatalf("expected pageLimit=40, got %v", plan1.Slices[i].Params["pageLimit"])
		}
	}
}
