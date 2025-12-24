package tests

import (
	"context"
	"testing"
	"time"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	"github.com/nucleus/ucl-core/internal/orchestration"
)

func TestIngestionE2EProgressCounters(t *testing.T) {
	requireLocalMinioEnv(t)

	templateID := registerStubEndpoint("stub.ingestion.progress", 90, 3, nil)
	manager := orchestration.NewManager()

	resp, err := manager.StartOperation(context.Background(), &pb.StartOperationRequest{
		TemplateId: templateID,
		EndpointId: "endpoint-progress",
		Kind:       pb.OperationKind_INGESTION_RUN,
		Parameters: map[string]string{"dataset_id": "stub.progress.dataset"},
	})
	if err != nil {
		t.Fatalf("StartOperation failed: %v", err)
	}

	state := waitForState(t, manager, resp.OperationId, 2*time.Second)
	if state.Status != pb.OperationStatus_SUCCEEDED {
		t.Fatalf("operation failed: %+v", state)
	}

	total := parseInt(t, state.Stats["slicesTotal"])
	done := parseInt(t, state.Stats["slicesDone"])
	if total != 3 || done != 3 {
		t.Fatalf("slice counters mismatch: total=%d done=%d", total, done)
	}

	expected := expectedRecords(90, 3)
	written := parseInt(t, state.Stats["recordsWritten"])
	if written != expected {
		t.Fatalf("recordsWritten mismatch: got %d want %d", written, expected)
	}

	if parseInt(t, state.Stats["bytesStaged"]) == 0 {
		t.Fatalf("expected bytesStaged > 0")
	}
}
