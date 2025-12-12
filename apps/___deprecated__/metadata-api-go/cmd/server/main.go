// Package main is the entry point for the metadata-api Go service.
// Note: For full GraphQL support, run `go generate ./...` to generate gqlgen code.
// This version uses a basic HTTP handler approach.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/nucleus/metadata-api/graph"
	"github.com/nucleus/metadata-api/internal/auth"
	"github.com/nucleus/metadata-api/internal/config"
	"github.com/nucleus/metadata-api/internal/database"
	"github.com/nucleus/metadata-api/internal/temporal"
	"github.com/nucleus/metadata-api/internal/ucl"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	cfg := config.Load()

	// Initialize database connection
	db, err := database.NewClient(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := db.Migrate(cfg.MigrationsPath); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	// Initialize UCL client
	uclClient, err := ucl.NewClient(cfg.UCLAddress)
	if err != nil {
		log.Fatalf("failed to connect to UCL service: %v", err)
	}
	defer uclClient.Close()

	// Initialize Temporal client
	temporalClient, err := temporal.NewClient(cfg)
	if err != nil {
		log.Fatalf("failed to connect to Temporal: %v", err)
	}
	defer temporalClient.Close()

	// Initialize GraphQL resolver
	resolver := graph.NewResolver(db, uclClient, temporalClient.Client())

	// Set up HTTP routes
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/graphql", graphqlHandler(resolver))

	// Apply auth middleware
	handler := auth.Middleware(cfg)(mux)

	// Start HTTP server
	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		cancel()
		if err := server.Shutdown(context.Background()); err != nil {
			log.Printf("error shutting down server: %v", err)
		}
	}()

	log.Printf("Metadata API (Go) listening on :%s", cfg.Port)
	log.Printf("GraphQL endpoint: http://localhost:%s/graphql", cfg.Port)
	log.Printf("Health endpoint: http://localhost:%s/health", cfg.Port)
	
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": "0.1.0",
	})
}

// graphqlHandler creates a basic GraphQL handler.
// For production use, run `go generate` to use gqlgen's handler.
func graphqlHandler(resolver *graph.Resolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			// Serve playground HTML
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(playgroundHTML))
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Query         string         `json:"query"`
			OperationName string         `json:"operationName"`
			Variables     map[string]any `json:"variables"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"errors":[{"message":"invalid request body"}]}`, http.StatusBadRequest)
			return
		}

		// Simple query router - for demonstration
		// Full GraphQL execution requires gqlgen generation
		var result any
		var err error

		switch {
		case contains(req.Query, "health"):
			health, e := resolver.Query().Health(r.Context())
			result, err = map[string]any{"health": health}, e
		case contains(req.Query, "metadataEndpoints"):
			endpoints, e := resolver.Query().MetadataEndpoints(r.Context(), nil, nil)
			result, err = map[string]any{"metadataEndpoints": endpoints}, e
		default:
			result = nil
			err = nil
		}

		response := map[string]any{"data": result}
		if err != nil {
			response["errors"] = []map[string]string{{"message": err.Error()}}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

const playgroundHTML = `<!DOCTYPE html>
<html>
<head>
  <title>GraphQL Playground</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/css/index.css"/>
  <script src="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/js/middleware.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    window.addEventListener('load', function() {
      GraphQLPlayground.init(document.getElementById('root'), { endpoint: '/graphql' })
    })
  </script>
</body>
</html>`
