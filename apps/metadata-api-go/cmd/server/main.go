// Package main is the entry point for the metadata-api Go service.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"

	"github.com/nucleus/metadata-api/graph"
	"github.com/nucleus/metadata-api/internal/auth"
	"github.com/nucleus/metadata-api/internal/config"
	"github.com/nucleus/metadata-api/internal/database"
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

	// Initialize GraphQL resolver
	resolver := graph.NewResolver(db)

	// Create GraphQL server
	srv := handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: resolver}))

	// Set up HTTP routes
	mux := http.NewServeMux()
	mux.Handle("/", playground.Handler("GraphQL Playground", "/graphql"))
	mux.Handle("/graphql", auth.Middleware(cfg)(srv))
	mux.HandleFunc("/health", healthHandler)

	// Start HTTP server
	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: mux,
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
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok","version":"0.1.0"}`))
}
