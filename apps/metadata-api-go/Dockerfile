# =============================================================================
# BUILD STAGE
# =============================================================================
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /src

# Copy workspace modules first for better caching
COPY platform/ucl-core/go.mod platform/ucl-core/go.sum ./platform/ucl-core/
COPY platform/ucl-worker/go.mod platform/ucl-worker/go.sum ./platform/ucl-worker/
COPY apps/metadata-api-go/go.mod apps/metadata-api-go/go.sum ./apps/metadata-api-go/

# Download dependencies
RUN cd apps/metadata-api-go && go mod download

# Copy source code
COPY platform/ucl-core ./platform/ucl-core
COPY platform/ucl-worker ./platform/ucl-worker
COPY apps/metadata-api-go ./apps/metadata-api-go

# Build the server
WORKDIR /src/apps/metadata-api-go
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/metadata-api ./cmd/server

# Build the worker
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/metadata-worker ./cmd/worker

# =============================================================================
# RUNTIME STAGE
# =============================================================================
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1000 metadata && \
    adduser -u 1000 -G metadata -s /bin/sh -D metadata

WORKDIR /app

# Copy binaries
COPY --from=builder /bin/metadata-api /app/metadata-api
COPY --from=builder /bin/metadata-worker /app/metadata-worker

# Copy migrations
COPY apps/metadata-api-go/migrations /app/migrations

# Set ownership
RUN chown -R metadata:metadata /app

USER metadata

# Environment defaults
ENV METADATA_API_PORT=4010
ENV METADATA_MIGRATIONS_PATH=/app/migrations
ENV TEMPORAL_ADDRESS=temporal:7233
ENV TEMPORAL_NAMESPACE=default
ENV TEMPORAL_TASK_QUEUE=metadata

# Expose port
EXPOSE 4010

# Default command runs the API server
CMD ["/app/metadata-api"]
