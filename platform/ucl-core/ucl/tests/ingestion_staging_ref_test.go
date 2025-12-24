package tests

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	"github.com/nucleus/ucl-core/internal/orchestration"
	"github.com/nucleus/ucl-core/pkg/staging"
)

func TestIngestionUsesStageRefsForLargeRuns(t *testing.T) {
	requireLocalMinioEnv(t)

	templateID := registerStubEndpoint("stub.ingestion.large", 10000, 4, nil)
	manager := orchestration.NewManager()

	params := map[string]string{
		"dataset_id":      "stub.large.dataset",
		"estimated_bytes": fmt.Sprint(staging.DefaultLargeRunThresholdBytes + 1024),
	}

	ctx := context.Background()
	resp, err := manager.StartOperation(ctx, &pb.StartOperationRequest{
		TemplateId: templateID,
		EndpointId: "endpoint-large",
		Kind:       pb.OperationKind_INGESTION_RUN,
		Parameters: params,
	})
	if err != nil {
		t.Fatalf("StartOperation failed: %v", err)
	}

	state := waitForState(t, manager, resp.OperationId, 3*time.Second)
	if state.Status != pb.OperationStatus_SUCCEEDED {
		t.Fatalf("operation not successful: %+v", state)
	}

	stageRef := state.Stats["stageRef"]
	if stageRef == "" {
		t.Fatalf("expected stageRef in stats, got none")
	}
	if len(stageRef) > 80 {
		t.Fatalf("stageRef too large for Temporal payload: %s", stageRef)
	}

	written := parseInt(t, state.Stats["recordsWritten"])
	expected := expectedRecords(10000, 4)
	if written != expected {
		t.Fatalf("recordsWritten mismatch: got %d expected %d", written, expected)
	}

	if state.Stats["batches"] == "" {
		t.Fatalf("expected batch count in stats")
	}

	bytesStaged := parseInt(t, state.Stats["bytesStaged"])
	if bytesStaged == 0 {
		t.Fatalf("expected staged bytes to be recorded")
	}
}

func waitForState(t *testing.T, manager *orchestration.Manager, opID string, timeout time.Duration) *pb.OperationState {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state, err := manager.GetOperation(context.Background(), &pb.GetOperationRequest{OperationId: opID})
		if err != nil {
			t.Fatalf("GetOperation failed: %v", err)
		}
		if state.Status == pb.OperationStatus_SUCCEEDED || state.Status == pb.OperationStatus_FAILED {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("operation %s did not complete in time", opID)
	return nil
}

func parseInt(t *testing.T, raw string) int {
	val, err := strconv.Atoi(raw)
	if err != nil {
		t.Fatalf("failed to parse int from %q: %v", raw, err)
	}
	return val
}

func expectedRecords(total, slices int) int {
	if slices <= 0 {
		return total
	}
	per := (total + slices - 1) / slices
	return per * slices
}
