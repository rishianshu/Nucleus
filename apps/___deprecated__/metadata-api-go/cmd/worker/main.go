// Package main is the entry point for the Temporal worker.
// Note: This worker registers workflows and metadata activities.
// UCL activities (CollectCatalogSnapshots, PreviewDataset, etc.) should be
// registered by a separate ucl-worker process on the "metadata-go" task queue.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/nucleus/metadata-api/internal/config"
	"github.com/nucleus/metadata-api/internal/database"
	temporal_internal "github.com/nucleus/metadata-api/internal/temporal"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	cfg := config.Load()

	// Initialize database
	db, err := database.NewClient(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	// Create Temporal client
	c, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
	})
	if err != nil {
		log.Fatalf("failed to create Temporal client: %v", err)
	}
	defer c.Close()

	// Create worker for metadata task queue
	w := worker.New(c, cfg.TemporalTaskQueue, worker.Options{})

	// Register metadata activities
	metadataActivities := temporal_internal.NewMetadataActivities(db)
	w.RegisterActivity(metadataActivities.CreateCollectionRun)
	w.RegisterActivity(metadataActivities.MarkRunStarted)
	w.RegisterActivity(metadataActivities.MarkRunCompleted)
	w.RegisterActivity(metadataActivities.MarkRunSkipped)
	w.RegisterActivity(metadataActivities.MarkRunFailed)
	w.RegisterActivity(metadataActivities.PrepareCollectionJob)
	w.RegisterActivity(metadataActivities.PersistCatalogRecords)
	w.RegisterActivity(metadataActivities.StartIngestionRun)
	w.RegisterActivity(metadataActivities.CompleteIngestionRun)
	w.RegisterActivity(metadataActivities.FailIngestionRun)
	w.RegisterActivity(metadataActivities.LoadStagedRecords)

	// Register workflows
	w.RegisterWorkflow(temporal_internal.CollectionRunWorkflowFunc)
	w.RegisterWorkflow(temporal_internal.IngestionRunWorkflowFunc)
	w.RegisterWorkflow(temporal_internal.ListEndpointTemplatesWorkflowFunc)
	w.RegisterWorkflow(temporal_internal.BuildEndpointConfigWorkflowFunc)
	w.RegisterWorkflow(temporal_internal.TestEndpointConnectionWorkflowFunc)
	w.RegisterWorkflow(temporal_internal.PreviewDatasetWorkflowFunc)

	// Start worker
	errCh := make(chan error, 1)
	go func() {
		errCh <- w.Run(worker.InterruptCh())
	}()

	log.Printf("Temporal worker started on task queue: %s", cfg.TemporalTaskQueue)
	log.Printf("Note: UCL activities (CollectCatalogSnapshots, PreviewDataset, etc.) must be")
	log.Printf("      registered by ucl-worker on the 'metadata-go' task queue")

	// Handle shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("received signal %s, shutting down...", sig)
		cancel()
	case err := <-errCh:
		if err != nil {
			log.Printf("worker error: %v", err)
		}
	}
}
