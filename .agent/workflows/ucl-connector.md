# UCL Connector Development Workflow

---
description: Add a new connector to UCL following the standard pattern
---

## Prerequisites
- [ ] UCL Proto contracts finalized (`api/v1/connector.proto`)
- [ ] Target system API documentation available
- [ ] Authentication method identified

## Phase 1: Specification

### 1.1 Create Connector Intent
```bash
mkdir -p intents/ucl-connector-<name>
```

Create `INTENT.md`:
```yaml
title: UCL <Name> Connector
slug: ucl-connector-<name>
type: feature
context: platform/ucl-core/internal/connector/<name>
scope_in:
  - ValidateConfig
  - GetCapabilities
  - ListDatasets
  - GetSchema
  - Read (streaming)
  - GetStatistics
  - <Actions if applicable>
scope_out:
  - Write operations (unless specified)
acceptance:
  1. Connection validation returns version
  2. ListDatasets returns expected units
  3. Read streams 1000 records without error
  4. Schema matches source metadata
constraints:
  - Must handle rate limiting
  - Must support incremental reads
```

### 1.2 Define Connector Spec
Create `SPEC.md` with:
- API endpoints used
- Authentication flow
- Pagination strategy
- Error mapping
- Rate limit handling

---

## Phase 2: Implementation

### 2.1 Create Package Structure
// turbo
```bash
mkdir -p internal/connector/<name>
touch internal/connector/<name>/service.go
touch internal/connector/<name>/client.go
touch internal/connector/<name>/config.go
touch internal/connector/<name>/mapper.go
```

### 2.2 Implement ConnectorService Interface
```go
// service.go
type Service struct {
    connectorv1.UnimplementedConnectorServiceServer
    client *Client
}

func (s *Service) ValidateConfig(ctx, req) (*ValidateConfigResponse, error)
func (s *Service) GetCapabilities(ctx, req) (*GetCapabilitiesResponse, error)
func (s *Service) ListDatasets(ctx, req) (*ListDatasetsResponse, error)
func (s *Service) GetSchema(ctx, req) (*GetSchemaResponse, error)
func (s *Service) Read(req, stream) error
func (s *Service) GetStatistics(ctx, req) (*GetStatisticsResponse, error)
```

### 2.3 Implement API Client
```go
// client.go
type Client struct {
    baseURL    string
    httpClient *http.Client
    auth       AuthConfig
}

func (c *Client) Get(ctx, path) (*Response, error)
func (c *Client) Post(ctx, path, body) (*Response, error)
```

### 2.4 Add to Registry
In `internal/gateway/registry/connectors.go`:
```go
registry.Register("<name>", func(cfg) Connector {
    return <name>.NewService(cfg)
})
```

---

## Phase 3: Testing

### 3.1 Unit Tests
// turbo
```bash
touch internal/connector/<name>/service_test.go
go test ./internal/connector/<name>/...
```

### 3.2 Integration Tests
```bash
touch tests/integration/<name>_test.go
go test -tags=integration ./tests/integration/...
```

### 3.3 Acceptance Validation
Verify each AC in ACCEPTANCE.md passes.

---

## Phase 4: Documentation

### 4.1 Update Connector Reference
Add to `docs/connectors/<name>.md`:
- Configuration fields
- Supported datasets
- CDM mappings
- Rate limit behavior
- Known limitations

### 4.2 Update API Reference
Add connector to `docs/api_reference.md`.
