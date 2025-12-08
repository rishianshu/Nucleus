# Low-Level Design: UCL Gateway Service

## 1. Overview
The Gateway is the **user-facing entry point** for UCL. It provides a unified gRPC API that routes requests to appropriate connectors and orchestration services.

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       UCL Gateway                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Discovery  │  │  Data Plane │  │   Control   │         │
│  │   Handler   │  │   Handler   │  │   Plane     │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│  ┌──────┴────────────────┴────────────────┴──────┐         │
│  │              Connector Registry               │         │
│  └──────────────────────┬────────────────────────┘         │
│                         │                                   │
│  ┌──────────────────────┴────────────────────────┐         │
│  │              Connection Pool                  │         │
│  └───────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  JDBC    │   │  Jira    │   │  HTTP    │
    │Connector │   │Connector │   │Connector │
    └──────────┘   └──────────┘   └──────────┘
```

---

## 3. Package Structure

```
cmd/ucl-gateway/
├── main.go              # Entry point
├── config.go            # Configuration loading
└── server.go            # gRPC server setup

internal/gateway/
├── handler/
│   ├── discovery.go     # ListEndpoints, GetDescriptor
│   ├── data.go          # GetSchema, ReadData, WriteData
│   └── control.go       # ExecuteAction
├── registry/
│   ├── connector.go     # Connector registration
│   └── pool.go          # Connection pooling
├── middleware/
│   ├── auth.go          # Authentication
│   ├── logging.go       # Request logging
│   └── metrics.go       # Prometheus metrics
└── service.go           # GatewayService implementation
```

---

## 4. Key Interfaces

### 4.1 ConnectorRegistry
```go
type ConnectorRegistry interface {
    // Register a connector factory
    Register(templateID string, factory ConnectorFactory) error
    
    // Get a connector instance for an endpoint
    Get(endpointID string) (Connector, error)
    
    // List available connector templates
    ListTemplates() []TemplateInfo
}

type ConnectorFactory func(config *structpb.Struct) (Connector, error)

type Connector interface {
    connectorv1.ConnectorServiceClient
    io.Closer
}
```

### 4.2 ConnectionPool
```go
type ConnectionPool interface {
    // Get or create a connection to a connector
    Acquire(endpointID string, config *structpb.Struct) (*grpc.ClientConn, error)
    
    // Release a connection back to pool
    Release(conn *grpc.ClientConn) error
    
    // Health check all connections
    HealthCheck(ctx context.Context) error
}
```

---

## 5. Request Flow

### 5.1 Discovery: ListEndpoints
```
Client → Gateway.ListEndpoints()
    → ConnectorRegistry.ListTemplates()
    → EndpointStore.ListByEnvironment()
    ← [EndpointDescription, ...]
```

### 5.2 Data Plane: ReadData
```
Client → Gateway.ReadData(endpoint_id, dataset_id)
    → ConnectorRegistry.Get(endpoint_id)
    → connector.Read(request)
    ← stream(record) → stream(record) to client
```

### 5.3 Control Plane: ExecuteAction
```
Client → Gateway.ExecuteAction(endpoint_id, action, params, mode=SYNC)
    → ConnectorRegistry.Get(endpoint_id)
    → connector.Execute(action, params)
    ← ExecuteActionResponse

Client → Gateway.ExecuteAction(endpoint_id, action, params, mode=ASYNC)
    → TemporalClient.StartWorkflow(ActionWorkflow, params)
    ← ExecuteActionResponse{execution_id, status_url}
```

---

## 6. Configuration

```yaml
gateway:
  host: 0.0.0.0
  port: 50051
  
  # TLS configuration
  tls:
    enabled: true
    cert_file: /etc/ucl/tls/server.crt
    key_file: /etc/ucl/tls/server.key
  
  # Connection pool settings
  pool:
    max_idle_per_host: 10
    max_conns_per_host: 100
    idle_timeout: 5m
  
  # Connector discovery
  connectors:
    jdbc:
      type: embedded
      binary: /usr/local/bin/ucl-jdbc
    jira:
      type: sidecar
      address: localhost:50052
    http:
      type: embedded
      binary: /usr/local/bin/ucl-http
  
  # Temporal configuration
  temporal:
    host: temporal:7233
    namespace: ucl-prod
    task_queue: ucl-workers
```

---

## 7. Error Handling

### gRPC Status Mapping
| Scenario | gRPC Code | Details |
| :--- | :--- | :--- |
| Endpoint not found | `NOT_FOUND` | endpoint_id invalid |
| Connector unavailable | `UNAVAILABLE` | Connection failed |
| Invalid config | `INVALID_ARGUMENT` | Validation errors |
| Auth failure | `UNAUTHENTICATED` | Token invalid |
| Permission denied | `PERMISSION_DENIED` | Insufficient scope |
| Timeout | `DEADLINE_EXCEEDED` | RPC timeout |

### Error Response Structure
```protobuf
message ErrorDetail {
    string code = 1;      // "UCL_CONNECTOR_ERROR"
    string message = 2;   // Human readable
    map<string, string> metadata = 3;
}
```

---

## 8. Observability

### Metrics (Prometheus)
```
ucl_gateway_requests_total{method, status}
ucl_gateway_request_duration_seconds{method}
ucl_gateway_active_connections{connector_type}
ucl_gateway_stream_records_total{endpoint_id, direction}
```

### Traces (OpenTelemetry)
- Span per RPC
- Child spans for connector calls
- Baggage: endpoint_id, user_id, tenant_id

### Logs (Structured JSON)
```json
{
  "level": "info",
  "method": "ReadData",
  "endpoint_id": "prod-postgres-1",
  "dataset_id": "orders",
  "records": 1500,
  "duration_ms": 234
}
```
