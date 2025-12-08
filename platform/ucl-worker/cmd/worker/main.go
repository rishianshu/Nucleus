// Package main runs the UCL Temporal worker.
package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/nucleus/ucl-worker/internal/activities"
)

const (
	defaultTaskQueue     = "metadata-go"
	defaultTemporalAddr  = "127.0.0.1:7233"
	defaultNamespace     = "default"
)

func main() {
	// Configuration from environment
	temporalAddr := getEnv("TEMPORAL_ADDRESS", defaultTemporalAddr)
	namespace := getEnv("TEMPORAL_NAMESPACE", defaultNamespace)
	taskQueue := getEnv("METADATA_GO_TASK_QUEUE", defaultTaskQueue)

	log.Printf("Starting UCL worker: address=%s namespace=%s queue=%s",
		temporalAddr, namespace, taskQueue)

	// Create Temporal client
	c, err := client.Dial(client.Options{
		HostPort:  temporalAddr,
		Namespace: namespace,
	})
	if err != nil {
		log.Fatalf("Failed to create Temporal client: %v", err)
	}
	defer c.Close()

	// Create worker
	w := worker.New(c, taskQueue, worker.Options{})

	// Register activities
	acts := activities.NewActivities()
	w.RegisterActivity(acts.CollectCatalogSnapshots)
	w.RegisterActivity(acts.PreviewDataset)
	w.RegisterActivity(acts.PlanIngestionUnit)
	w.RegisterActivity(acts.RunIngestionUnit)

	log.Printf("Registered 4 activities: CollectCatalogSnapshots, PreviewDataset, PlanIngestionUnit, RunIngestionUnit")

	// Run worker
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("Worker failed: %v", err)
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
