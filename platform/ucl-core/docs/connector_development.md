# Connector Development Guide

This guide explains how to add a new Endpoint (Connector) to the Universal Connectivity Layer (UCL).

## Prerequisite: The Philosophy
A Connector in UCL is **NOT** just a data pipe. It is an **Action Executor**.
Your job is to map a high-level intent (e.g., `Slack.SendMessage`) to a low-level API call.

## Step 1: Define the Capabilities
Before writing code, define what your connector can do.
Decide on the **Template ID** (e.g., `notion.api`) and the **Actions**.

**Example Actions**:
- `create_page`
- `query_database`
- `append_block`

## Step 2: Implement the Interface
You will implement the `connector.Service` interface (generated from `connector.proto`).

Create a new package in `internal/connector/<name>/`.

```go
package notion

import (
    "context"
    pb "github.com/nucleus/ucl-core/gen/connector/v1"
)

type Connector struct {}

// 1. Validate Config
func (c *Connector) ValidateConfig(ctx context.Context, req *pb.ValidateConfigRequest) (*pb.ValidateConfigResponse, error) {
    // Check if API Key exists in req.Config
}

// 2. Discover Capabilities
func (c *Connector) GetCapabilities(ctx context.Context, req *pb.GetCapabilitiesRequest) (*pb.GetCapabilitiesResponse, error) {
    return &pb.GetCapabilitiesResponse{
        Actions: []*pb.ActionDefinition{
            {Name: "create_page", InputSchemaJson: "{...}"},
        },
    }, nil
}

// 3. Execute
func (c *Connector) Execute(ctx context.Context, req *pb.ExecuteRequest) (*pb.ExecuteResponse, error) {
    switch req.Action {
    case "create_page":
        return c.createPage(req.Parameters)
    default:
        return nil, status.Errorf(codes.Unimplemented, "unknown action")
    }
}
```

## Step 3: Register the Connector
Register your new connector in the main Gateway factory (`internal/connector/registry.go`).

```go
func InitRegistry() {
    registry.Register("notion.api", notion.New())
}
```

## Step 4: Testing
We prioritize **Contract Tests**.
Instead of just mocking HTTP, use the UCL Test Runner to verify your connector against the real (sandbox) API or a recorded tape.
Run: `go test ./internal/connector/notion/...`

## Checklist
- [ ] Schema defined for Inputs/Outputs
- [ ] `ValidateConfig` handles missing auth gracefully
- [ ] Errors mapped to standard gRPC codes (e.g., 404 -> `NotFound`)
