# UCL Worker Dockerfile
# Go Temporal worker for UCL connectors

FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache gcc musl-dev git

WORKDIR /build

# Copy go.mod and go.sum first for better caching
COPY platform/ucl-worker/go.mod platform/ucl-worker/go.sum ./ucl-worker/
COPY platform/ucl-core/go.mod platform/ucl-core/go.sum ./ucl-core/

# Download dependencies
RUN cd ucl-worker && go mod download
RUN cd ucl-core && go mod download

# Copy source code
COPY platform/ucl-worker ./ucl-worker
COPY platform/ucl-core ./ucl-core

# Build the worker with optimizations
RUN cd ucl-worker && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /worker ./cmd/worker

# Runtime image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

# CODEX FIX: Add non-root user for security
RUN addgroup -g 1000 worker && adduser -u 1000 -G worker -D worker
WORKDIR /app
COPY --from=builder /worker /app/worker
RUN chown worker:worker /app/worker

USER worker

# Worker configuration via environment
ENV TEMPORAL_HOST_PORT=temporal:7233
ENV TEMPORAL_NAMESPACE=default
ENV TASK_QUEUE=brain-go

ENTRYPOINT ["/app/worker"]
