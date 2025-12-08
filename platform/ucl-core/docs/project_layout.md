# UCL Project Layout & Structure

This project follows the [Standard Go Project Layout](https://github.com/golang-standards/project-layout), ensuring predictability and clarity for developers.

## Directory Structure

```text
platform/ucl-core/
├── api/                    # Protocol Buffer definitions (The Contract)
│   └── v1/
│       ├── gateway.proto   # Public API (User -> UCL)
│       └── connector.proto # Internal API (UCL -> Plugin)
├── cmd/                    # Main applications (Entry points)
│   ├── ucl-gateway/        # The API Server (User-facing)
│   │   └── main.go
│   └── ucl-worker/         # The Temporal Worker (Async Processor)
│       └── main.go
├── internal/               # Private application code (Library logic)
│   ├── server/             # gRPC Server implementation
│   ├── workflow/           # Temporal Workflow definitions
│   ├── connector/          # Connector management & specific implementations
│   │   ├── jira/           # Embedded Jira Connector
│   │   └── postgres/       # Embedded Postgres Connector
│   └── config/             # Configuration loading logic
├── pkg/                    # Public libraries (Safe to import by others)
│   └── uclclient/          # Go Client SDK for UCL
├── docs/                   # Architecture & Design documents
├── go.mod                  # Go Module definition
├── Makefile                # Build automation
└── buf.gen.yaml            # Proto generation config
```

## Key Directories Explained

### `api/`
The single source of truth. All changes start here. We use `buf` to generate Go code from these files.

### `cmd/`
Contains the `main` packages. These should be small and do little more than wire up dependencies (from `internal/`) and start the application.

### `internal/`
The meat of the application. Code here cannot be imported by other Go modules, enforcing loose coupling.
- **`connector/`**: Contains the logic for specific systems. This is where most new development happens.

### `pkg/`
Code that we expect other Nucleus services to import. For example, a typed client to call UCL easily.
