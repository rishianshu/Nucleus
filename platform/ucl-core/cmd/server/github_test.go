package main

import (
	"context"
	"strings"
	"testing"

	pb "github.com/nucleus/ucl-core/gen/go/proto"
	github "github.com/nucleus/ucl-core/internal/connector/github"
)

func TestGitHubTestConnectionViaServer(t *testing.T) {
	stub := github.NewStubServer()
	defer stub.Close()

	s := &server{}
	ctx := context.Background()

	successReq := &pb.TestConnectionRequest{
		TemplateId: "http.github",
		Parameters: map[string]string{
			"base_url": stub.URL(),
			"token":    "stub-token",
		},
	}
	resp, err := s.TestEndpointConnection(ctx, successReq)
	if err != nil {
		t.Fatalf("TestEndpointConnection error: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got %+v", resp)
	}

	badTokenReq := &pb.TestConnectionRequest{
		TemplateId: "http.github",
		Parameters: map[string]string{
			"base_url": stub.URL(),
			"token":    "bad-token",
		},
	}
	badResp, err := s.TestEndpointConnection(ctx, badTokenReq)
	if err != nil {
		t.Fatalf("TestEndpointConnection error (bad token): %v", err)
	}
	if badResp.Success {
		t.Fatalf("expected failure for bad token")
	}
	if code := badResp.Details["code"]; code != "E_AUTH_INVALID" {
		t.Fatalf("expected E_AUTH_INVALID, got %s", code)
	}

	rateLimitReq := &pb.TestConnectionRequest{
		TemplateId: "http.github",
		Parameters: map[string]string{
			"base_url": stub.URL(),
			"token":    "rate-limit",
		},
	}
	rateResp, err := s.TestEndpointConnection(ctx, rateLimitReq)
	if err != nil {
		t.Fatalf("TestEndpointConnection error (rate limit): %v", err)
	}
	if rateResp.Success {
		t.Fatalf("expected failure for rate limited token")
	}
	if code := rateResp.Details["code"]; code != "" && code != "E_RATE_LIMITED" {
		t.Fatalf("expected E_RATE_LIMITED, got %s", code)
	}
	if rateResp.Details["code"] == "" && !strings.Contains(strings.ToLower(rateResp.Error), "rate") {
		t.Fatalf("expected rate-limit diagnostics, got %+v", rateResp)
	}
}
