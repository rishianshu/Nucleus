package tests

import (
	"context"
	"fmt"
	"testing"
	"time"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	"github.com/nucleus/ucl-core/internal/orchestration"
	"github.com/nucleus/ucl-core/pkg/staging"
)

func TestIngestionNegativeCases(t *testing.T) {
	t.Run("staging unavailable", func(t *testing.T) {
		templateID := registerStubEndpoint("stub.ingestion.noobject", 100, 1, nil)
		manager := orchestration.NewManager()

		params := map[string]string{
			"dataset_id":           "stub.noobject.dataset",
			"disable_object_store": "true",
			"estimated_bytes":      fmt.Sprint(staging.DefaultLargeRunThresholdBytes * 5),
		}

		resp, err := manager.StartOperation(context.Background(), &pb.StartOperationRequest{
			TemplateId: templateID,
			EndpointId: "endpoint-noobject",
			Kind:       pb.OperationKind_INGESTION_RUN,
			Parameters: params,
		})
		if err != nil {
			t.Fatalf("StartOperation failed: %v", err)
		}

		state := waitForState(t, manager, resp.OperationId, 2*time.Second)
		if state.Status != pb.OperationStatus_FAILED {
			t.Fatalf("expected failure, got %s", state.Status.String())
		}
		if state.Error == nil || state.Error.Code != string(staging.CodeStagingUnavailable) {
			t.Fatalf("expected staging unavailable error, got %+v", state.Error)
		}
	})

	t.Run("auth failure", func(t *testing.T) {
		templateID := registerStubEndpoint("stub.ingestion.auth", 50, 1, fmt.Errorf("auth failure"))
		manager := orchestration.NewManager()

		resp, err := manager.StartOperation(context.Background(), &pb.StartOperationRequest{
			TemplateId: templateID,
			EndpointId: "endpoint-auth",
			Kind:       pb.OperationKind_INGESTION_RUN,
			Parameters: map[string]string{"dataset_id": "stub.auth.dataset"},
		})
		if err != nil {
			t.Fatalf("StartOperation failed: %v", err)
		}

		state := waitForState(t, manager, resp.OperationId, 2*time.Second)
		if state.Status != pb.OperationStatus_FAILED {
			t.Fatalf("expected failure, got %s", state.Status.String())
		}
		if state.Error == nil || state.Error.Code != "E_AUTH_INVALID" {
			t.Fatalf("expected auth error, got %+v", state.Error)
		}
		if state.Error != nil && state.Error.Retryable {
			t.Fatalf("auth errors should not be retryable")
		}
	})

	t.Run("endpoint unreachable", func(t *testing.T) {
		templateID := registerStubEndpoint("stub.ingestion.unreachable", 50, 1, fmt.Errorf("endpoint unreachable"))
		manager := orchestration.NewManager()

		resp, err := manager.StartOperation(context.Background(), &pb.StartOperationRequest{
			TemplateId: templateID,
			EndpointId: "endpoint-unreachable",
			Kind:       pb.OperationKind_INGESTION_RUN,
			Parameters: map[string]string{"dataset_id": "stub.unreachable.dataset"},
		})
		if err != nil {
			t.Fatalf("StartOperation failed: %v", err)
		}

		state := waitForState(t, manager, resp.OperationId, 2*time.Second)
		if state.Status != pb.OperationStatus_FAILED {
			t.Fatalf("expected failure, got %s", state.Status.String())
		}
		if state.Error == nil || state.Error.Code != "E_ENDPOINT_UNREACHABLE" {
			t.Fatalf("expected unreachable error, got %+v", state.Error)
		}
		if state.Error != nil && !state.Error.Retryable {
			t.Fatalf("unreachable should be retryable")
		}
	})
}
