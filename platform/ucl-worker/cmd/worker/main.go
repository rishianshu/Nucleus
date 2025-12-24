// Package main runs the UCL Temporal worker.
package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	orchestration "github.com/nucleus/ucl-core/pkg/orchestration"
	"github.com/nucleus/ucl-worker/internal/activities"
)

const (
	defaultTaskQueue    = "metadata-go"
	defaultTemporalAddr = "127.0.0.1:7233"
	defaultNamespace    = "default"
)

func main() {
	temporalAddr := getEnv("TEMPORAL_ADDRESS", defaultTemporalAddr)
	namespace := getEnv("TEMPORAL_NAMESPACE", defaultNamespace)
	taskQueue := getEnv("METADATA_GO_TASK_QUEUE", defaultTaskQueue)

	log.Printf("Starting UCL worker: address=%s namespace=%s queue=%s",
		temporalAddr, namespace, taskQueue)

	c, err := client.Dial(client.Options{
		HostPort:  temporalAddr,
		Namespace: namespace,
	})
	if err != nil {
		log.Fatalf("Failed to create Temporal client: %v", err)
	}
	defer c.Close()

	w := worker.New(c, taskQueue, worker.Options{})

	acts := activities.NewActivities()
	w.RegisterActivity(acts.CollectCatalogSnapshots)
	w.RegisterActivity(acts.PreviewDataset)
	w.RegisterActivity(acts.PlanIngestionUnit)
	w.RegisterActivity(acts.RunIngestionUnit)
	w.RegisterActivity(orchestration.SinkRunner)

	log.Printf("Registered ingestion activities: CollectCatalogSnapshots, PreviewDataset, PlanIngestionUnit, RunIngestionUnit, SinkRunner")

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
