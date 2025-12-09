# UCL gRPC Gateway Dockerfile
# gRPC server for endpoint registry operations

FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache gcc musl-dev git

WORKDIR /build

# Copy go.mod and go.sum first for better caching
COPY platform/ucl-core/go.mod platform/ucl-core/go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY platform/ucl-core ./

# Build the server with optimizations
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

# Runtime image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

# CODEX FIX: Add non-root user for security
RUN addgroup -g 1000 server && adduser -u 1000 -G server -D server
WORKDIR /app
COPY --from=builder /server /app/server
RUN chown server:server /app/server

USER server

# gRPC server configuration
ENV UCL_GRPC_PORT=50051

EXPOSE 50051

ENTRYPOINT ["/app/server"]
