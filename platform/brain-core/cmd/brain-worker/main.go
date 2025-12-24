package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/nucleus/brain-core/internal/activities"
)

const (
	defaultTaskQueue    = "brain-go"
	defaultTemporalAddr = "127.0.0.1:7233"
	defaultNamespace    = "default"
)

func main() {
	temporalAddr := getEnv("TEMPORAL_ADDRESS", defaultTemporalAddr)
	namespace := getEnv("TEMPORAL_NAMESPACE", defaultNamespace)
	taskQueue := getEnv("BRAIN_GO_TASK_QUEUE", defaultTaskQueue)

	log.Printf("Starting brain worker: address=%s namespace=%s queue=%s",
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
	w.RegisterActivity(acts.IndexArtifact)
	w.RegisterActivity(acts.ExtractSignals)
	w.RegisterActivity(acts.ExtractInsights)
	w.RegisterActivity(acts.BuildClusters)

	log.Printf("Registered brain activities: IndexArtifact, ExtractSignals, ExtractInsights, BuildClusters")

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
