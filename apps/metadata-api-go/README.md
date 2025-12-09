# Metadata API (Go)

GraphQL API server for metadata management, endpoint registration, catalog discovery, and ingestion orchestration.

## Quick Start

```bash
# Install dependencies
go mod tidy

# Generate GraphQL code
go generate ./...

# Run the server
DATABASE_URL="postgres://..." go run ./cmd/server

# Run the Temporal worker
DATABASE_URL="postgres://..." TEMPORAL_ADDRESS="localhost:7233" go run ./cmd/worker
```

## Architecture

```
cmd/
├── server/     # GraphQL API server
└── worker/     # Temporal worker

internal/
├── auth/       # JWT authentication
├── config/     # Configuration
├── database/   # PostgreSQL client & queries
└── temporal/   # Workflows & activities

graph/
├── schema.graphqls   # GraphQL schema
├── resolver.go       # Root resolver
└── schema.resolvers.go  # Query/mutation implementations

migrations/
└── 000001_initial_schema.up.sql  # Database schema
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `METADATA_API_PORT` | `4010` | API server port |
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `metadata` | Temporal task queue |
| `AUTH_JWKS_URL` | | JWKS URL for JWT validation |
| `METADATA_DEFAULT_PROJECT` | `global` | Default project ID |
| `INGESTION_DEFAULT_SINK` | `kb` | Default ingestion sink |

## Docker

```bash
# Build
docker build -t metadata-api-go .

# Run API server
docker run -p 4010:4010 -e DATABASE_URL="..." metadata-api-go

# Run worker
docker run -e DATABASE_URL="..." metadata-api-go /app/metadata-worker
```
