.PHONY: proto lint test build clean

# Proto generation
proto:
	@echo "Generating proto files..."
	buf generate api

# Lint protos
proto-lint:
	@echo "Linting proto files..."
	buf lint api

# Check for breaking changes
proto-breaking:
	@echo "Checking for breaking changes..."
	buf breaking api --against '.git#branch=main'

# Build all binaries
build:
	@echo "Building UCL binaries..."
	go build -o bin/ucl-gateway ./cmd/ucl-gateway
	go build -o bin/ucl-worker ./cmd/ucl-worker

# Run tests
test:
	@echo "Running tests..."
	go test -v -race ./...

# Run tests with coverage
test-cover:
	@echo "Running tests with coverage..."
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Lint Go code
lint:
	@echo "Linting Go code..."
	golangci-lint run ./...

# Format code
fmt:
	@echo "Formatting code..."
	go fmt ./...
	buf format -w api

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf bin/ gen/ coverage.out coverage.html

# Full CI check
ci: proto-lint lint test build
	@echo "CI check complete"

# Development: generate and build
dev: proto build
	@echo "Development build complete"

# Install dependencies
deps:
	@echo "Installing dependencies..."
	go mod download
	go install github.com/bufbuild/buf/cmd/buf@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Help
help:
	@echo "UCL Core Makefile"
	@echo ""
	@echo "Usage:"
	@echo "  make proto          Generate Go code from protos"
	@echo "  make proto-lint     Lint proto files"
	@echo "  make build          Build all binaries"
	@echo "  make test           Run tests"
	@echo "  make lint           Lint Go code"
	@echo "  make ci             Full CI check"
	@echo "  make dev            Proto + build (for development)"
	@echo "  make deps           Install dependencies"
	@echo "  make clean          Clean build artifacts"
